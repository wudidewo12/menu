#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const toolDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(toolDir, '..');

function usage() {
  return `
Usage:
  pnpm image:review

Options:
  --prompts <path>     Prompt markdown path, default: tools/dish-image-prompts.md
  --review-dir <path>  Output folder, default: public/images/dish-review
  --force              Regenerate existing review images
  --limit <number>     Generate only the first N prompts
  --only <slugs>       Comma-separated slugs to generate
  --dry-run            Print planned jobs without calling Ark
  -h, --help           Show this help
`.trim();
}

function parseArgs(argv) {
  const args = {
    prompts: 'tools/dish-image-prompts.md',
    reviewDir: 'public/images/dish-review',
    force: false,
    limit: null,
    only: null,
    dryRun: false,
  };

  const tokens = [...argv];
  if (tokens[0] === '--') tokens.shift();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const nextValue = () => {
      const value = tokens[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${token}`);
      }
      index += 1;
      return value;
    };

    switch (token) {
      case '-h':
      case '--help':
        args.help = true;
        break;
      case '--prompts':
        args.prompts = nextValue();
        break;
      case '--review-dir':
        args.reviewDir = nextValue();
        break;
      case '--force':
        args.force = true;
        break;
      case '--limit':
        args.limit = Number(nextValue());
        break;
      case '--only':
        args.only = new Set(
          nextValue()
            .split(',')
            .map((slug) => slug.trim())
            .filter(Boolean)
        );
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit < 1)) {
    throw new Error('--limit must be a positive number.');
  }

  return args;
}

function parsePromptMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const items = [];
  let current = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^#{2,3} /.test(line)) {
      current = {
        name: line.replace(/^#{2,3} /, '').trim(),
        slug: '',
        prompt: '',
      };
      continue;
    }

    if (!current) continue;

    const slugMatch = line.match(/^slug:\s*`([^`]+)`/);
    if (slugMatch) {
      current.slug = slugMatch[1];
      continue;
    }

    if (line.trim() === '```text') {
      const promptLines = [];
      index += 1;

      while (index < lines.length && lines[index].trim() !== '```') {
        promptLines.push(lines[index]);
        index += 1;
      }

      current.prompt = promptLines.join('\n').trim();
      if (current.name && current.slug && current.prompt) {
        items.push(current);
      }
      current = null;
    }
  }

  return items;
}

async function readExistingReviewData(reviewDataPath) {
  if (!existsSync(reviewDataPath)) return [];

  try {
    return JSON.parse(await readFile(reviewDataPath, 'utf8'));
  } catch {
    return [];
  }
}

function runImageReplace(item, outputPath) {
  return spawnSync(
    'node',
    [
      join(projectRoot, 'tools/ark-image-replace.mjs'),
      '--prompt',
      item.prompt,
      '--output',
      outputPath,
      '--no-watermark',
      '--no-backup',
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
    }
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const promptsPath = resolve(projectRoot, args.prompts);
  const reviewDirRelative = args.reviewDir.replace(/^\.\//, '').replace(/\/$/, '');
  const reviewDir = resolve(projectRoot, reviewDirRelative);
  const reviewDataPath = join(reviewDir, 'review-data.json');
  const publicReviewBase = `/${reviewDirRelative.replace(/^public\//, '')}`;

  await mkdir(reviewDir, { recursive: true });

  const prompts = parsePromptMarkdown(await readFile(promptsPath, 'utf8'));
  const selected = prompts
    .filter((item) => !args.only || args.only.has(item.slug))
    .slice(0, args.limit ?? prompts.length);

  const previousData = await readExistingReviewData(reviewDataPath);
  const reviewDataBySlug = new Map(previousData.map((item) => [item.slug, item]));

  console.log(`Prompts: ${promptsPath}`);
  console.log(`Output: ${reviewDir}`);
  console.log(`Found ${prompts.length} prompts. Generating ${selected.length} review images.`);

  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const relativeOutput = `${reviewDirRelative}/${item.slug}.webp`;
    const outputPath = join(projectRoot, relativeOutput);
    const publicReviewImage = `${publicReviewBase}/${item.slug}.webp`;
    const originalImagePath = join(projectRoot, `public/images/dishes/${item.slug}.webp`);
    const publicOriginalImage = existsSync(originalImagePath)
      ? `/images/dishes/${item.slug}.webp`
      : '/images/dishes/default-dish.png';

    if (!args.force && existsSync(outputPath)) {
      console.log(`[${index + 1}/${selected.length}] skip ${item.name} (${item.slug})`);
      reviewDataBySlug.set(item.slug, {
        ...item,
        originalImage: publicOriginalImage,
        reviewImage: publicReviewImage,
        status: 'skipped-existing',
      });
      continue;
    }

    if (args.dryRun) {
      console.log(`[${index + 1}/${selected.length}] dry-run ${item.name} (${item.slug})`);
      reviewDataBySlug.set(item.slug, {
        ...item,
        originalImage: publicOriginalImage,
        reviewImage: publicReviewImage,
        status: 'dry-run',
      });
      continue;
    }

    console.log(`[${index + 1}/${selected.length}] generate ${item.name} (${item.slug})`);
    const result = runImageReplace(item, relativeOutput);

    if (result.status === 0) {
      reviewDataBySlug.set(item.slug, {
        ...item,
        originalImage: publicOriginalImage,
        reviewImage: publicReviewImage,
        status: 'generated',
      });
      console.log(`  ok -> ${relativeOutput}`);
    } else {
      const errorText = (result.stderr || result.stdout || '').trim();
      reviewDataBySlug.set(item.slug, {
        ...item,
        originalImage: publicOriginalImage,
        reviewImage: publicReviewImage,
        status: 'failed',
        error: errorText,
      });
      console.log(`  failed -> ${errorText}`);
    }

    await writeFile(
      reviewDataPath,
      JSON.stringify(Array.from(reviewDataBySlug.values()), null, 2),
      'utf8'
    );
  }

  await writeFile(
    reviewDataPath,
    JSON.stringify(Array.from(reviewDataBySlug.values()), null, 2),
    'utf8'
  );

  console.log(`Review data: ${reviewDataPath}`);
  console.log(
    `Open: http://127.0.0.1:3001/dish-image-review.html?data=${encodeURIComponent(`${publicReviewBase}/review-data.json`)}`
  );
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
