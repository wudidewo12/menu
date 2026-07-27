'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchMenu, saveMenuRequest, uploadDishImageRequest } from './admin-api';
import {
  allVisibleDishIds,
  blankDish,
  blankSection,
  cleanDishIds,
  defaultDishIdsForSource,
  dishesForSection,
  fieldValue,
  moveDishByDirection,
  moveSectionByDirection,
  normalizeDishForSave,
  reorderDishIds,
  removeDishFromMenu,
  removeSectionById,
  sectionSourceLabel,
  splitIngredients,
} from './admin-utils';

function AdminEditor() {
  const [password, setPassword] = useState('');
  const [savedPassword, setSavedPassword] = useState('');
  const [menu, setMenu] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageRevisions, setImageRevisions] = useState({});
  const [activeSectionId, setActiveSectionId] = useState(null);
  const [adminTab, setAdminTab] = useState('dishes');
  const [sectionAddDishIds, setSectionAddDishIds] = useState({});
  const [draggedSectionDish, setDraggedSectionDish] = useState(null);
  const draggedSectionDishRef = useRef(null);

  useEffect(() => {
    setSavedPassword(window.sessionStorage.getItem('menu.adminPassword') || '');
  }, []);

  useEffect(() => {
    fetchMenu()
      .then((nextMenu) => {
        setMenu(nextMenu);
        setSelectedId(nextMenu.dishes?.[0]?.id ?? null);
        setActiveSectionId(nextMenu.settings?.sections?.[0]?.id ?? null);
      })
      .catch((error) => setMessage(`读取菜单失败：${error.message}`));
  }, []);

  const dishes = menu?.dishes || [];
  const sections = menu?.settings?.sections || [];
  const selectedDish = dishes.find((dish) => dish.id === selectedId) || dishes[0] || null;
  const sortedSections = useMemo(
    () => [...sections].sort((a, b) => a.sortOrder - b.sortOrder),
    [sections],
  );
  const activeSection = sortedSections.find((section) => section.id === activeSectionId) || sortedSections[0] || null;
  const activeSectionIndex = activeSection
    ? sortedSections.findIndex((section) => section.id === activeSection.id)
    : -1;

  const categoryOptions = useMemo(() => {
    const values = new Set(['肉菜', '海鲜', '素菜', '主食', '汤甜', '凉菜']);
    sections.forEach((section) => {
      if (section.category) values.add(section.category);
    });
    dishes.forEach((dish) => {
      if (dish.category) values.add(dish.category);
    });
    return [...values];
  }, [dishes, sections]);

  const adminPassword = savedPassword || password;
  const selectedImage = selectedDish?.image || '/images/dishes/default-dish.png';
  const selectedImageSrc = selectedImage.startsWith('/uploads/')
    ? `${selectedImage}?v=${imageRevisions[selectedDish?.id] || 0}`
    : selectedImage;
  const activeSectionDishes = activeSection ? dishesForSection(activeSection, dishes) : [];
  const activeSectionDishIds = new Set(activeSectionDishes.map((dish) => dish.id));
  const activeSectionAddableDishes = [...dishes]
    .filter((dish) => dish.visible !== false && !activeSectionDishIds.has(dish.id))
    .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || Number(a.id) - Number(b.id));

  useEffect(() => {
    if (!draggedSectionDish) return undefined;

    const stopDragging = () => endSectionDishDrag();
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('touchend', stopDragging);

    return () => {
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('touchend', stopDragging);
    };
  }, [draggedSectionDish]);

  function dishIdsForSection(section) {
    return dishesForSection(section, dishes).map((dish) => dish.id);
  }

  function updateMenu(updater) {
    setMenu((prevMenu) => {
      const nextMenu = structuredClone(prevMenu);
      updater(nextMenu);
      return nextMenu;
    });
  }

  function updateDish(id, patch) {
    updateMenu((nextMenu) => {
      nextMenu.dishes = nextMenu.dishes.map((dish) => (
        dish.id === id ? { ...dish, ...patch } : dish
      ));
    });
  }

  function moveDish(id, direction) {
    updateMenu((nextMenu) => {
      nextMenu.dishes = moveDishByDirection(nextMenu.dishes, id, direction);
    });
  }

  function addDish() {
    const nextId = Math.max(0, ...dishes.map((dish) => Number(dish.id) || 0)) + 1;
    const nextDish = blankDish(nextId, dishes.length + 1);
    updateMenu((nextMenu) => {
      nextMenu.dishes.push(nextDish);
    });
    setSelectedId(nextId);
  }

  function removeDish(id) {
    updateMenu((nextMenu) => {
      const result = removeDishFromMenu(
        nextMenu.dishes,
        nextMenu.settings.sections,
        id,
      );
      nextMenu.dishes = result.dishes;
      nextMenu.settings.sections = result.sections;
    });
    setSelectedId(dishes.find((dish) => dish.id !== id)?.id ?? null);
  }

  function updateSection(id, patch) {
    updateMenu((nextMenu) => {
      nextMenu.settings.sections = nextMenu.settings.sections.map((section) => (
        section.id === id ? { ...section, ...patch } : section
      ));
    });
  }

  function addSection() {
    const nextSection = blankSection(sections.length);
    updateMenu((nextMenu) => {
      nextMenu.settings.sections.push(nextSection);
    });
    setActiveSectionId(nextSection.id);
  }

  function moveSection(id, direction) {
    updateMenu((nextMenu) => {
      nextMenu.settings.sections = moveSectionByDirection(
        nextMenu.settings.sections,
        id,
        direction,
      );
    });
  }

  function updateSectionSource(id, value) {
    updateSection(id, {
      recommendedOnly: value === '__recommended__',
      category: value === '__recommended__' ? null : value,
      dishIds: defaultDishIdsForSource(value, dishes),
    });
  }

  function setSectionDishIds(sectionId, ids) {
    const allowedIds = new Set(allVisibleDishIds(dishes));
    updateSection(sectionId, {
      dishIds: cleanDishIds(ids).filter((dishId) => allowedIds.has(dishId)),
    });
  }

  function addDishToSection(section) {
    const dishId = Number(sectionAddDishIds[section.id]);
    if (!Number.isFinite(dishId)) return;
    setSectionDishIds(section.id, [...dishIdsForSection(section), dishId]);
    setSectionAddDishIds((values) => ({ ...values, [section.id]: '' }));
  }

  function removeDishFromSection(section, dishId) {
    setSectionDishIds(section.id, dishIdsForSection(section).filter((id) => id !== dishId));
  }

  function beginSectionDishDrag(sectionId, dishId) {
    const value = { sectionId, dishId };
    draggedSectionDishRef.current = value;
    setDraggedSectionDish(value);
  }

  function endSectionDishDrag() {
    draggedSectionDishRef.current = null;
    setDraggedSectionDish(null);
  }

  function shouldIgnoreDishDragStart(event) {
    return event.target instanceof Element && event.target.closest('.admin-section-dish-remove');
  }

  function moveSectionDish(section, targetDishId, rawSourceDishId) {
    const activeDrag = draggedSectionDishRef.current || draggedSectionDish;
    const sourceDishId = Number.isFinite(rawSourceDishId) && rawSourceDishId > 0
      ? rawSourceDishId
      : activeDrag?.dishId;
    if (activeDrag && activeDrag.sectionId !== section.id) return;
    if (!Number.isFinite(sourceDishId)) return;
    if (sourceDishId === targetDishId) return;

    const nextDishIds = reorderDishIds(
      dishIdsForSection(section),
      sourceDishId,
      targetDishId,
    );
    if (!nextDishIds) return;

    setSectionDishIds(section.id, nextDishIds);
  }

  function removeSection(id) {
    updateMenu((nextMenu) => {
      nextMenu.settings.sections = removeSectionById(nextMenu.settings.sections, id);
    });
    if (activeSectionId === id) {
      setActiveSectionId(sortedSections.find((section) => section.id !== id)?.id ?? null);
    }
  }

  async function saveMenu() {
    if (!adminPassword) {
      setMessage('先输入管理密码。');
      return;
    }

    setSaving(true);
    setMessage('');
    const payload = {
      ...menu,
      dishes: dishes.map(normalizeDishForSave),
    };

    try {
      const savedMenu = await saveMenuRequest(payload, adminPassword);
      setMenu(savedMenu);
      setSavedPassword(adminPassword);
      window.sessionStorage.setItem('menu.adminPassword', adminPassword);
      setMessage('已保存。普通菜单页会在几秒内刷新。');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadDishImage(file) {
    if (!file || !selectedDish) return;
    if (!adminPassword) {
      setMessage('先输入管理密码再上传图片。');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setMessage('只能上传图片文件。');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setMessage('图片不能超过 12MB。');
      return;
    }

    setUploading(true);
    setMessage('');

    try {
      const payload = await uploadDishImageRequest(
        file,
        selectedDish.id,
        menu.version,
        adminPassword,
      );

      if (payload.menu) {
        setMenu(payload.menu);
      } else {
        updateDish(selectedDish.id, { image: payload.url, images: [payload.url] });
      }
      setImageRevisions((revisions) => ({ ...revisions, [selectedDish.id]: Date.now() }));
      setSavedPassword(adminPassword);
      window.sessionStorage.setItem('menu.adminPassword', adminPassword);
      setMessage('图片已更新。');
    } catch (error) {
      setMessage(error.message);
    } finally {
      setUploading(false);
    }
  }

  if (!menu) {
    return (
      <main className="menu-page admin-page">
        <div className="admin-shell">
          <section className="paper-panel admin-card">
            {message ? (
              <>
                <h1 className="display-type text-4xl font-semibold">后台 API 没连上</h1>
                <p className="mt-3 text-sm leading-6 text-[#6b5846]">{message}</p>
                <p className="mt-3 text-sm leading-6 text-[#6b5846]">
                  后台需要用 `node server.js` 跑生产服务器，不能只跑 `next dev`。
                </p>
              </>
            ) : (
              '正在读取菜单...'
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="menu-page admin-page">
      <div className="admin-shell">
        <header className="ink-panel admin-hero">
          <div>
            <p className="site-kicker">菜单后台</p>
            <h1 className="display-type">编辑菜单</h1>
            <p>加菜、下架、改分类、调顺序。保存后朋友打开同一个链接会看到最新菜单。</p>
          </div>
          <div className="admin-auth">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={savedPassword ? '已记住本次密码' : '管理密码'}
            />
            <button type="button" onClick={saveMenu} disabled={saving}>
              {saving ? '保存中' : '保存'}
            </button>
          </div>
        </header>

        {message ? <div className="admin-message">{message}</div> : null}

        <section className="paper-panel admin-settings">
          <label>
            <span>菜单标题</span>
            <input
              value={fieldValue(menu.settings.title)}
              onChange={(event) => updateMenu((nextMenu) => {
                nextMenu.settings.title = event.target.value;
              })}
            />
          </label>
          <label>
            <span>副标题</span>
            <input
              value={fieldValue(menu.settings.subtitle)}
              onChange={(event) => updateMenu((nextMenu) => {
                nextMenu.settings.subtitle = event.target.value;
              })}
            />
          </label>
        </section>

        <section className="paper-panel admin-workbench">
          <div className="admin-workbench-tabs">
            <button
              type="button"
              className={adminTab === 'dishes' ? 'admin-workbench-tab admin-workbench-tab-on' : 'admin-workbench-tab'}
              onClick={() => setAdminTab('dishes')}
            >
              菜品
              <span>{dishes.length} 道</span>
            </button>
            <button
              type="button"
              className={adminTab === 'sections' ? 'admin-workbench-tab admin-workbench-tab-on' : 'admin-workbench-tab'}
              onClick={() => setAdminTab('sections')}
            >
              首页分类
              <span>{sortedSections.length} 个</span>
            </button>
          </div>

          {adminTab === 'dishes' ? (
            <section className="admin-grid">
              <aside className="admin-list">
                <div className="admin-list-head">
                  <h2>菜品</h2>
                  <button type="button" onClick={addDish}>加菜</button>
                </div>
                <div className="admin-dish-list">
                  {[...dishes].sort((a, b) => a.sortOrder - b.sortOrder).map((dish) => (
                    <button
                      key={dish.id}
                      type="button"
                      onClick={() => setSelectedId(dish.id)}
                      className={dish.id === selectedDish?.id ? 'admin-dish-item admin-dish-item-on' : 'admin-dish-item'}
                    >
                      <strong>{dish.name}</strong>
                      <span>{dish.category}{dish.visible === false ? ' · 已下架' : ''}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="admin-editor">
                {selectedDish ? (
                  <>
                    <div className="admin-editor-head">
                      <h2>{selectedDish.name}</h2>
                      <div>
                        <button type="button" onClick={() => moveDish(selectedDish.id, -1)}>上移</button>
                        <button type="button" onClick={() => moveDish(selectedDish.id, 1)}>下移</button>
                        <button type="button" className="admin-danger" onClick={() => removeDish(selectedDish.id)}>删除</button>
                      </div>
                    </div>

                    <div className="admin-form">
                      <label>
                        <span>菜名</span>
                        <input value={fieldValue(selectedDish.name)} onChange={(event) => updateDish(selectedDish.id, { name: event.target.value })} />
                      </label>
                      <label>
                        <span>分类</span>
                        <input list="category-options" value={fieldValue(selectedDish.category)} onChange={(event) => updateDish(selectedDish.id, { category: event.target.value })} />
                        <datalist id="category-options">
                          {categoryOptions.map((category) => <option key={category} value={category} />)}
                        </datalist>
                      </label>
                      <label>
                        <span>口味标签</span>
                        <input value={fieldValue(selectedDish.accent)} onChange={(event) => updateDish(selectedDish.id, { accent: event.target.value })} />
                      </label>
                      <label>
                        <span>出锅时长</span>
                        <input value={fieldValue(selectedDish.prepTime)} onChange={(event) => updateDish(selectedDish.id, { prepTime: event.target.value })} />
                      </label>
                      <label>
                        <span>难度</span>
                        <select value={fieldValue(selectedDish.difficulty)} onChange={(event) => updateDish(selectedDish.id, { difficulty: event.target.value })}>
                          <option value="简单">简单</option>
                          <option value="中等">中等</option>
                          <option value="困难">困难</option>
                        </select>
                      </label>
                      <label>
                        <span>份量</span>
                        <input value={fieldValue(selectedDish.servings)} onChange={(event) => updateDish(selectedDish.id, { servings: event.target.value })} />
                      </label>
                      <div className="admin-image-field">
                        <div className="admin-image-tools">
                          <div className="admin-image-preview">
                            <img src={selectedImageSrc} alt="" />
                          </div>
                          <div className="admin-upload-copy">
                            <label className={uploading ? 'admin-upload-button admin-upload-button-disabled' : 'admin-upload-button'}>
                              {uploading ? '上传中' : '换图'}
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/gif"
                                disabled={uploading}
                                onChange={(event) => {
                                  const file = event.target.files?.[0];
                                  event.target.value = '';
                                  uploadDishImage(file);
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                      <label className="admin-wide">
                        <span>描述</span>
                        <textarea value={fieldValue(selectedDish.description)} onChange={(event) => updateDish(selectedDish.id, { description: event.target.value })} />
                      </label>
                      <label className="admin-wide">
                        <span>食材，一行一个或用逗号分隔</span>
                        <textarea value={(selectedDish.ingredients || []).join('\n')} onChange={(event) => updateDish(selectedDish.id, { ingredients: splitIngredients(event.target.value) })} />
                      </label>
                      <label className="admin-check">
                        <input type="checkbox" checked={Boolean(selectedDish.recommended)} onChange={(event) => updateDish(selectedDish.id, { recommended: event.target.checked })} />
                        <span>放进推荐</span>
                      </label>
                      <label className="admin-check">
                        <input type="checkbox" checked={selectedDish.visible !== false} onChange={(event) => updateDish(selectedDish.id, { visible: event.target.checked })} />
                        <span>上架显示</span>
                      </label>
                    </div>
                  </>
                ) : (
                  <p>还没有菜品。</p>
                )}
              </section>
            </section>
          ) : (
            <section className="admin-section-workspace">
              <aside className="admin-section-nav">
                <div className="admin-list-head">
                  <h2>首页分类</h2>
                  <button type="button" onClick={addSection}>加分类</button>
                </div>
                <div className="admin-section-nav-list">
                  {sortedSections.map((section) => {
                    const sectionDishes = dishesForSection(section, dishes);
                    return (
                      <button
                        key={section.id}
                        type="button"
                        className={section.id === activeSection?.id ? 'admin-section-nav-item admin-section-nav-item-on' : 'admin-section-nav-item'}
                        onClick={() => setActiveSectionId(section.id)}
                      >
                        <strong>{section.label}</strong>
                      <span>{sectionSourceLabel(section)} · {sectionDishes.length} 道菜</span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="admin-section-detail">
                {activeSection ? (
                  <>
                    <div className="admin-editor-head">
                      <h2>{activeSection.title}</h2>
                      <div>
                        <button type="button" onClick={() => moveSection(activeSection.id, -1)} disabled={activeSectionIndex === 0}>上移</button>
                        <button type="button" onClick={() => moveSection(activeSection.id, 1)} disabled={activeSectionIndex === sortedSections.length - 1}>下移</button>
                        <button type="button" className="admin-danger" onClick={() => removeSection(activeSection.id)}>删除</button>
                      </div>
                    </div>

                    <div className="admin-section-config">
                      <label>
                        <span>按钮名</span>
                        <input value={activeSection.label} onChange={(event) => updateSection(activeSection.id, { label: event.target.value })} aria-label="分类按钮名" />
                      </label>
                      <label>
                        <span>标题</span>
                        <input value={activeSection.title} onChange={(event) => updateSection(activeSection.id, { title: event.target.value })} aria-label="分类标题" />
                      </label>
                      <label className="admin-section-note">
                        <span>说明</span>
                        <input value={activeSection.note} onChange={(event) => updateSection(activeSection.id, { note: event.target.value })} aria-label="分类说明" />
                      </label>
                      <label>
                        <span>内容来源</span>
                        <select
                          value={activeSection.recommendedOnly ? '__recommended__' : activeSection.category || ''}
                          onChange={(event) => updateSectionSource(activeSection.id, event.target.value)}
                          aria-label="内容来源"
                        >
                          <option value="__recommended__">推荐菜</option>
                          {categoryOptions.map((category) => (
                            <option key={category} value={category}>{category}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="admin-section-dishes">
                      <div className="admin-section-dishes-head">
                        <span>这个分类里的菜</span>
                        <div className="admin-section-add">
                          <select
                            value={sectionAddDishIds[activeSection.id] || ''}
                            onChange={(event) => setSectionAddDishIds((values) => ({
                              ...values,
                              [activeSection.id]: event.target.value,
                            }))}
                            disabled={!activeSectionAddableDishes.length}
                            aria-label="选择要加入这个分类的菜"
                          >
                            <option value="">
                              {activeSectionAddableDishes.length ? '选择菜品' : '没有可添加的菜'}
                            </option>
                            {activeSectionAddableDishes.map((dish) => (
                              <option key={dish.id} value={dish.id}>{dish.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => addDishToSection(activeSection)}
                            disabled={!activeSectionAddableDishes.length || !sectionAddDishIds[activeSection.id]}
                          >
                            添加
                          </button>
                        </div>
                      </div>
                      {activeSectionDishes.length ? (
                        <div className="admin-section-dish-list">
                          {activeSectionDishes.map((dish) => (
                            <div
                              key={dish.id}
                              data-section-dish-id={dish.id}
                              className={
                                draggedSectionDish?.sectionId === activeSection.id && draggedSectionDish?.dishId === dish.id
                                  ? 'admin-section-dish-chip admin-section-dish-chip-dragging'
                                  : 'admin-section-dish-chip'
                              }
                              onMouseDown={(event) => {
                                if (event.button !== 0 || shouldIgnoreDishDragStart(event)) return;
                                beginSectionDishDrag(activeSection.id, dish.id);
                              }}
                              onMouseEnter={() => moveSectionDish(activeSection, dish.id)}
                              onMouseUp={endSectionDishDrag}
                              onPointerDown={(event) => {
                                if (event.button !== 0) return;
                                if (shouldIgnoreDishDragStart(event)) return;
                                beginSectionDishDrag(activeSection.id, dish.id);
                              }}
                              onPointerEnter={() => moveSectionDish(activeSection, dish.id)}
                              onPointerUp={endSectionDishDrag}
                              onPointerCancel={endSectionDishDrag}
                              onTouchStart={(event) => {
                                if (shouldIgnoreDishDragStart(event)) return;
                                beginSectionDishDrag(activeSection.id, dish.id);
                              }}
                              onTouchMove={(event) => {
                                const touch = event.touches[0];
                                const target = document
                                  .elementFromPoint(touch.clientX, touch.clientY)
                                  ?.closest('.admin-section-dish-chip');
                                const targetDishId = Number(target?.getAttribute('data-section-dish-id'));
                                if (Number.isFinite(targetDishId)) {
                                  moveSectionDish(activeSection, targetDishId);
                                }
                              }}
                              onTouchEnd={endSectionDishDrag}
                            >
                              <button
                                type="button"
                                className="admin-section-dish-name"
                                onClick={() => {
                                  setSelectedId(dish.id);
                                  setAdminTab('dishes');
                                }}
                              >
                                {dish.name}
                              </button>
                              <button
                                type="button"
                                className="admin-section-dish-remove"
                                onClick={() => removeDishFromSection(activeSection, dish.id)}
                                aria-label={`从${activeSection.label}移除${dish.name}`}
                              >
                                删除
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p>这个分类还没有菜，先从上面加几道。</p>
                      )}
                    </div>
                  </>
                ) : (
                  <p>还没有首页分类。</p>
                )}
              </section>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

export default function AdminPage() {
  return <AdminEditor />;
}
