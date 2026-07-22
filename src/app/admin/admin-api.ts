import type { Menu } from '@/types/menu';

interface ApiErrorResponse {
  error?: string;
}

export interface DishImageUploadResponse {
  url: string;
  filename: string;
  linked: boolean;
  size: number;
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

export async function saveMenuRequest(menu: Menu, adminPassword: string): Promise<Menu> {
  const response = await fetch('/api/menu', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Password': adminPassword,
    },
    body: JSON.stringify(menu),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('管理密码不对');
    }

    throw new Error(`保存失败：${response.status}`);
  }

  return response.json() as Promise<Menu>;
}

export async function uploadDishImageRequest(
  file: File,
  dishId: number,
  adminPassword: string,
): Promise<DishImageUploadResponse> {
  const data = await readFileAsDataUrl(file);
  const response = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Password': adminPassword,
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      dishId,
      data,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('管理密码不对');
    }

    const payload = await response.json().catch(() => ({})) as ApiErrorResponse;
    throw new Error(payload.error || `上传失败：${response.status}`);
  }

  return response.json() as Promise<DishImageUploadResponse>;
}
