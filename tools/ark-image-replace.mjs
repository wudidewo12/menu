#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const DEFAULT_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
const DEFAULT_MODEL = 'doubao-seedream-5-0-260128';

const toolDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(toolDir, '..');

function usage() {
  return `
Usage:
  pnpm image:replace --prompt "真实家常酸菜鱼..." --output public/images/dishes/suan-cai-yu.webp

Options:
  --prompt <text>                         Image prompt text
  --prompt-file <path>                    Read prompt from a UTF-8 file
  --output <path>                         Target image path to replace
  --endpoint <url>                        Ark endpoint
  --model <model>                         Ark image model
  --size <size>                           Image size, default: 2K
  --response-format <url|b64_json>        Default: url
  --sequential-image-generation <value>   Default: disabled
  --watermark                             Enable watermark, default
  --no-watermark                          Disable watermark
  --api-key-env <name>                    Env var name, default: ARK_API_KEY
  --timeout <seconds>                     Request timeout, default: 180
  --webp-quality <1-100>                  cwebp quality, default: 92
  --no-backup                             Replace without creating .bak file
  --dry-run                               Print request payload only
  -h, --help                              Show this help
`.trim();
}

function parseArgs(argv) {
  const args = {
    endpoint: DEFAULT_ENDPOINT,
    model: DEFAULT_MODEL,
    size: '2K',
    responseFormat: 'url',
    sequentialImageGeneration: 'disabled',
    watermark: true,
    apiKeyEnv: 'ARK_API_KEY',
    timeout: 180,
    webpQuality: 92,
    backup: true,
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
      case '--prompt':
        args.prompt = nextValue();
        break;
      case '--prompt-file':
        args.promptFile = nextValue();
        break;
      case '--output':
        args.output = nextValue();
        break;
      case '--endpoint':
        args.endpoint = nextValue();
        break;
      case '--model':
        args.model = nextValue();
        break;
      case '--size':
        args.size = nextValue();
        break;
      case '--response-format':
        args.responseFormat = nextValue();
        break;
      case '--sequential-image-generation':
        args.sequentialImageGeneration = nextValue();
        break;
      case '--watermark':
        args.watermark = true;
        break;
      case '--no-watermark':
        args.watermark = false;
        break;
      case '--api-key-env':
        args.apiKeyEnv = nextValue();
        break;
      case '--timeout':
        args.timeout = Number(nextValue());
        break;
      case '--webp-quality':
        args.webpQuality = Number(nextValue());
        break;
      case '--no-backup':
        args.backup = false;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        throw new Error(`Unknown option: ${token}`);
    }
  }

  return args;
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadLocalEnv() {
  const envPath = join(projectRoot, '.env.local');
  if (!existsSync(envPath)) return;

  const content = await readFile(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    const value = parseEnvValue(line.slice(separator + 1));
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function readPrompt(args) {
  if (args.prompt && args.promptFile) {
    throw new Error('Use either --prompt or --prompt-file, not both.');
  }

  const prompt = args.promptFile
    ? await readFile(resolve(projectRoot, args.promptFile), 'utf8')
    : args.prompt;

  if (!prompt?.trim()) {
    throw new Error('Missing prompt. Pass --prompt or --prompt-file.');
  }

  return prompt.trim();
}

function validateArgs(args) {
  if (args.help) return;

  if (!args.output) {
    throw new Error('Missing --output.');
  }
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) {
    throw new Error('--timeout must be a positive number.');
  }
  if (!Number.isFinite(args.webpQuality) || args.webpQuality < 1 || args.webpQuality > 100) {
    throw new Error('--webp-quality must be between 1 and 100.');
  }
  if (!['url', 'b64_json'].includes(args.responseFormat)) {
    throw new Error('--response-format must be url or b64_json.');
  }
}

function buildPayload(args, prompt) {
  return {
    model: args.model,
    prompt,
    sequential_image_generation: args.sequentialImageGeneration,
    response_format: args.responseFormat,
    size: args.size,
    stream: false,
    watermark: args.watermark,
  };
}

async function fetchWithTimeout(url, options, timeoutSeconds) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestGeneration(args, payload) {
  const apiKey = process.env[args.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing API key. Set ${args.apiKeyEnv}=ark-... in .env.local.`);
  }

  const response = await fetchWithTimeout(
    args.endpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    },
    args.timeout
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Ark request failed with HTTP ${response.status}: ${body}`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Ark returned non-JSON response.');
  }
}

function extractImageSource(responseData, responseFormat) {
  const first = responseData?.data?.[0];
  if (!first) {
    throw new Error(`Ark response has no image data: ${JSON.stringify(responseData).slice(0, 500)}`);
  }

  if (responseFormat === 'url') {
    if (!first.url) {
      throw new Error(`Ark response has no image URL: ${JSON.stringify(first).slice(0, 500)}`);
    }
    return { type: 'url', value: first.url };
  }

  if (!first.b64_json) {
    throw new Error(`Ark response has no b64_json image: ${JSON.stringify(first).slice(0, 500)}`);
  }
  return { type: 'b64_json', value: first.b64_json };
}

async function saveSourceToTemp(source, tempDir, timeoutSeconds) {
  const sourcePath = join(tempDir, 'ark-generated-source');

  if (source.type === 'b64_json') {
    await writeFile(sourcePath, Buffer.from(source.value, 'base64'));
    return sourcePath;
  }

  const response = await fetchWithTimeout(
    source.value,
    {
      method: 'GET',
      headers: {
        'User-Agent': 'menu-ark-image-replace/1.0',
      },
    },
    timeoutSeconds
  );

  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}: ${await response.text()}`);
  }

  await writeFile(sourcePath, Buffer.from(await response.arrayBuffer()));

  return sourcePath;
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

async function prepareReplacement(sourcePath, outputPath, args) {
  await mkdir(dirname(outputPath), { recursive: true });

  if (extname(outputPath).toLowerCase() !== '.webp') {
    const tempPath = join(dirname(outputPath), `.${Date.now()}.${process.pid}.tmp${extname(outputPath) || '.img'}`);
    await copyFile(sourcePath, tempPath);
    return tempPath;
  }

  const tempPath = join(dirname(outputPath), `.${Date.now()}.${process.pid}.tmp.webp`);
  const result = spawnSync(
    'cwebp',
    ['-quiet', '-q', String(args.webpQuality), sourcePath, '-o', tempPath],
    { encoding: 'utf8' }
  );

  if (result.error) {
    throw new Error('Target is .webp but cwebp is missing. Install with: brew install webp');
  }
  if (result.status !== 0) {
    await rm(tempPath, { force: true });
    throw new Error(`cwebp conversion failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  return tempPath;
}

async function replaceFile(tempPath, outputPath, shouldBackup) {
  let backupPath = null;
  if (shouldBackup && existsSync(outputPath)) {
    backupPath = `${outputPath}.${timestamp()}.bak`;
    await copyFile(outputPath, backupPath);
  }

  await rename(tempPath, outputPath);
  return backupPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  validateArgs(args);

  if (args.help) {
    console.log(usage());
    return;
  }

  await loadLocalEnv();

  const prompt = await readPrompt(args);
  const outputPath = resolve(projectRoot, args.output);
  const payload = buildPayload(args, prompt);

  if (args.dryRun) {
    console.log(JSON.stringify(payload, null, 2));
    console.log(`output: ${outputPath}`);
    return;
  }

  const responseData = await requestGeneration(args, payload);
  const source = extractImageSource(responseData, args.responseFormat);
  const tempDir = await mkdtemp(join(tmpdir(), 'ark-image-'));

  try {
    const sourcePath = await saveSourceToTemp(source, tempDir, args.timeout);
    const tempPath = await prepareReplacement(sourcePath, outputPath, args);
    const backupPath = await replaceFile(tempPath, outputPath, args.backup);

    if (source.type === 'url') {
      console.log(`image_url: ${source.value}`);
    }
    console.log(`replaced: ${outputPath}`);
    if (backupPath) {
      console.log(`backup: ${backupPath}`);
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
