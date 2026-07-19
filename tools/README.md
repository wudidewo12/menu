# Ark image replacement tool

Generate an image with Ark, download the returned image, and replace a target
file in this project.

Put your key in the project root:

```bash
ARK_API_KEY=ark-...
```

```bash
pnpm image:replace \
  --prompt "餐厅级酸菜鱼菜单摄影，精致摆盘，鱼片整齐铺陈，酸菜和红油汤底层次清晰，白色浅口瓷盘，干净餐桌，柔和侧光，专业美食摄影，真实质感，不要文字，不要水印" \
  --output public/images/dishes/suan-cai-yu.webp \
  --no-watermark
```

For `.webp` targets, the tool converts the generated image with `cwebp`.

```bash
brew install webp
```

Useful options:

```bash
pnpm image:replace --help
pnpm image:replace --prompt-file prompt.txt --output public/images/dishes/example.webp
pnpm image:replace --prompt "..." --output public/images/dishes/example.webp --dry-run
```
