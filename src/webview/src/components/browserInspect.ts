// 检查元素注入脚本（在访客页上下文执行）：悬停元素高亮描边 + 属性浮签
// （选择器/尺寸/颜色/字体，对齐参考形态），点击或 Esc 退出。幂等——检查开启
// 时再注入一次 = 关闭。字符串内只用单引号与拼接（模板字符串禁含反引号/${）。
export const INSPECT_OVERLAY_SCRIPT = `(() => {
  const KEY = '__ic_inspect_overlay';
  if (window[KEY]) { window[KEY](); return 'off'; }
  const box = document.createElement('div');
  const tip = document.createElement('div');
  box.style.cssText = 'position:fixed;display:none;outline:2px solid #4c9aff;background:rgba(76,154,255,.12);pointer-events:none;z-index:2147483646';
  tip.style.cssText = 'position:fixed;display:none;pointer-events:none;z-index:2147483647;background:#1c1c24;color:#f0f0f0;font:12px/1.5 monospace;padding:6px 9px;border-radius:6px;white-space:pre;box-shadow:0 4px 16px rgba(0,0,0,.4)';
  const off = () => {
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    box.remove();
    tip.remove();
    delete window[KEY];
  };
  const onMove = (event) => {
    const el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || el === document.documentElement) { box.style.display = 'none'; tip.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    const cls = typeof el.className === 'string' ? el.className.trim() : '';
    const name = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls ? '.' + cls.split(/\\s+/).join('.') : '');
    tip.textContent = name + '  ' + Math.round(r.width) + 'x' + Math.round(r.height) + '\\nColor ' + cs.color + '\\nFont ' + cs.fontSize + ' ' + cs.fontFamily;
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let top = r.top - th - 8;
    if (top < 8) top = r.bottom + 8;
    tip.style.left = Math.max(8, Math.min(r.left, window.innerWidth - tw - 8)) + 'px';
    tip.style.top = top + 'px';
  };
  const onDown = (event) => { event.preventDefault(); event.stopPropagation(); off(); };
  const onKey = (event) => { if (event.key === 'Escape') off(); };
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  document.documentElement.append(box, tip);
  window[KEY] = off;
  return 'on';
})()`;
