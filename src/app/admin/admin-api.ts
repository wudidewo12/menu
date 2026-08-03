import type { Menu } from '@/types/menu';

interface ApiErrorResponse {
  error?: string;
}

export interface DishImageUploadResponse {
  url: string;
  filename: string;
  linked: boolean;
  size: number;
  mimeType?: string;
  width?: number;
  height?: number;
  storageKey?: string;
  oldFileCleanupPending?: boolean;
  menu?: Menu;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

export async function fetchMenu(): Promise<Menu> {
  const response = await fetch('/api/menu', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`菜单 API 返回 ${response.status}`);
  }

  return response.json() as Promise<Menu>;
}

export async function saveMenuRequest(menu: Menu): Promise<Menu> {
  const response = await fetch('/api/menu', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(menu),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('登录会话已失效，请重新登录。');
    }

    if (response.status === 403) {
      throw new Error('当前账号没有修改菜单的权限。');
    }

    throw new Error(`保存失败：${response.status}`);
  }

  return response.json() as Promise<Menu>;
}

export async function uploadDishImageRequest(
  file: File,
  dishId: number,
  menuVersion: number,
): Promise<DishImageUploadResponse> {
  const data = await readFileAsDataUrl(file);
  const response = await fetch('/api/upload', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      dishId,
      menuVersion,
      data,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('登录会话已失效，请重新登录。');
    }

    if (response.status === 403) {
      throw new Error('当前账号没有上传图片的权限。');
    }

    const payload = await response.json().catch(() => ({})) as ApiErrorResponse;

    if (response.status === 409 && payload.error === 'MENU_VERSION_CONFLICT') {
      throw new Error('菜单已经被其他操作更新，请刷新后再上传图片。');
    }

    if (response.status === 404 && payload.error === 'DISH_NOT_IN_MENU') {
      throw new Error('菜品已不在当前菜单中，请刷新页面。');
    }

    if (response.status === 503) {
      throw new Error('图片服务暂时不可用，请稍后再试。');
    }

    throw new Error(payload.error || `上传失败：${response.status}`);
  }

  return response.json() as Promise<DishImageUploadResponse>;
}
