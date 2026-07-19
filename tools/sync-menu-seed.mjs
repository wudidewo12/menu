import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dishes } from '../src/app/data/dishes.js';

const sections = [
  { id: 'recommend', label: '推荐', title: '今晚推荐', note: '掌勺的拿手菜，先点不踩雷', category: null, recommendedOnly: true },
  { id: 'cold', label: '凉菜', title: '凉菜', note: '开场先垫一口', category: '凉菜', recommendedOnly: false },
  { id: 'seafood', label: '海鲜', title: '海鲜河鲜', note: '鲜味担当', category: '海鲜', recommendedOnly: false },
  { id: 'meat', label: '肉菜', title: '肉菜', note: '硬菜撑场面', category: '肉菜', recommendedOnly: false },
  { id: 'veggie', label: '素菜', title: '素菜时蔬', note: '解腻清口', category: '素菜', recommendedOnly: false },
  { id: 'staple', label: '主食', title: '主食', note: '压轴管饱', category: '主食', recommendedOnly: false },
  { id: 'soup', label: '汤甜', title: '汤羹甜品', note: '收尾暖胃', category: '汤甜', recommendedOnly: false },
].map((section, index) => ({
  ...section,
  dishIds: dishes
    .filter((dish) => (section.recommendedOnly ? dish.recommended : dish.category === section.category))
    .map((dish) => dish.id),
  sortOrder: index + 1,
}));

const menu = {
  version: 1,
  updatedAt: new Date().toISOString(),
  settings: {
    title: '灶台菜单',
    subtitle: `今晚想吃什么，自己点 · 共 ${dishes.length} 道家常菜`,
    sections,
  },
  dishes: dishes.map((dish, index) => ({
    ...dish,
    visible: true,
    sortOrder: index + 1,
  })),
};

const outputPath = path.join(process.cwd(), 'data', 'menu-seed.json');
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(menu, null, 2)}\n`);
console.log(`Wrote ${outputPath} (${dishes.length} dishes)`);
