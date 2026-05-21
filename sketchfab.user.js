// ==UserScript==
// @name         Sketchfab JOMB
// @version      1.0
// @description  Descargar modelos de Sketchfab
// @author       Jhojan
// @include      /^https?:\/\/(www\.)?sketchfab\.com\/.*$/
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/JhojanOMB/Tampermonkey/main/sketchfab.user.js
// @downloadURL  https://raw.githubusercontent.com/JhojanOMB/Tampermonkey/main/sketchfab.user.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip-utils/0.0.2/jszip-utils.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/1.3.8/FileSaver.js
// @grant        unsafeWindow
// @grant        GM_download
// ==/UserScript==

(() => {
  'use strict';
  const window = unsafeWindow || globalThis;
  const LOG_PREFIX = '[US2]';

  // caches y estructuras
  const allModels = [];
  const seenModels = new Set();
  const objects = {}; // name -> Blob (puede ser .obj o imagen)
  const saveImageCache = new Map();

  // regex para parcheos
  const func_drawGeometry = /(this\._stateCache\.drawGeometry\(this\._graphicContext,t\))/g;
  const fund_drawArrays = /t\.drawArrays\(t\.TRIANGLES,0,6\)/g;
  const func_renderInto1 = /A\.renderInto\(n,E,R/g;
  const func_renderInto2 = /g\.renderInto=function\(e,i,r/g;
  const func_getResourceImage = /getResourceImage:function\(e,t\){/g;

  // === UI: crear botón e insertarlo sobre el viewer (esquina superior derecha) ===
  function createUIInsideScene() {
    if (document.getElementById('us2-purple-btn')) return;

    const container = document.createElement('div');
    container.id = 'us2-container';
    container.style.position = 'absolute';
    container.style.right = '12px';
    container.style.top = '12px';
    container.style.zIndex = '999998';
    container.style.fontFamily = 'Inter, system-ui, sans-serif';

    const btn = document.createElement('button');
    btn.id = 'us2-purple-btn';
    btn.textContent = 'DESCARGAR';
    btn.title = 'Descargar modelo(s)';
    btn.style.padding = '8px 12px';
    btn.style.borderRadius = '10px';
    btn.style.border = '1px solid rgba(255,255,255,0.04)';
    btn.style.cursor = 'pointer';
    btn.style.color = '#fff';
    btn.style.background = 'linear-gradient(180deg,#2a0f3a 0%, #4b1c5f 100%)';
    btn.style.boxShadow = '0 6px 18px rgba(43, 15, 58, 0.45)';
    btn.style.fontWeight = '700';
    btn.style.fontSize = '13px';
    btn.style.letterSpacing = '0.4px';
    btn.style.backdropFilter = 'saturate(120%) blur(2px)';

    container.appendChild(btn);

    // overlay mínimo para progreso (oculto)
    const overlay = document.createElement('div');
    overlay.id = 'us2-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.background = 'rgba(10,8,15,0.55)';
    overlay.style.zIndex = '1000000';

    const card = document.createElement('div');
    card.style.width = '420px';
    card.style.maxWidth = '92%';
    card.style.background = '#11051a';
    card.style.color = '#f3e8ff';
    card.style.borderRadius = '12px';
    card.style.padding = '18px';
    card.style.boxShadow = '0 12px 40px rgba(0,0,0,0.6)';
    card.style.fontFamily = 'Inter, sans-serif';
    overlay.appendChild(card);

    const title = document.createElement('div');
    title.id = 'us2-title';
    title.textContent = 'Generando paquete';
    title.style.fontSize = '16px';
    title.style.fontWeight = '700';
    title.style.marginBottom = '8px';
    card.appendChild(title);

    const desc = document.createElement('div');
    desc.id = 'us2-desc';
    desc.textContent = 'Empaquetando modelos y texturas...';
    desc.style.fontSize = '13px';
    desc.style.opacity = '0.9';
    card.appendChild(desc);

    const progressWrap = document.createElement('div');
    progressWrap.style.marginTop = '14px';
    const progressBar = document.createElement('div');
    progressBar.id = 'us2-bar';
    progressBar.style.height = '12px';
    progressBar.style.width = '0%';
    progressBar.style.borderRadius = '8px';
    progressBar.style.background = 'linear-gradient(90deg,#5e2f6a,#a46abf)';
    progressWrap.appendChild(progressBar);
    card.appendChild(progressWrap);

    const percent = document.createElement('div');
    percent.id = 'us2-percent';
    percent.style.marginTop = '10px';
    percent.style.fontSize = '13px';
    percent.textContent = '0%';
    card.appendChild(percent);

    const small = document.createElement('div');
    small.id = 'us2-small';
    small.style.marginTop = '12px';
    small.style.fontSize = '12px';
    small.style.opacity = '0.85';
    small.textContent = 'Si no detecta modelos, ejecuta: window.forceScanModels()';
    card.appendChild(small);

    document.documentElement.appendChild(overlay);

    // encontrar contenedor del viewer
    const findSceneParent = () => {
      const trySelectors = [
        '.model-viewer',
        '.viewer',
        '.scene',
        '.sketchfab-viewer-embed',
        '.titlebar',
        '#viewer',
        '.model-viewport',
      ];
      for (const sel of trySelectors) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      const canv = document.querySelector('canvas');
      if (canv && canv.offsetParent) return canv.offsetParent;
      return null;
    };

    const parent = findSceneParent();
    if (parent) {
      const computed = window.getComputedStyle(parent);
      if (computed.position === 'static') parent.style.position = 'relative';
      container.style.position = 'absolute';
      container.style.right = '12px';
      container.style.top = '12px';
      parent.appendChild(container);
    } else {
      container.style.position = 'fixed';
      container.style.right = '18px';
      container.style.top = '18px';
      document.documentElement.appendChild(container);
    }

    btn.addEventListener('click', startDownloadFlow);

    // funciones para depuración
    window.forceScanModels = () => { tryScanGlobals(true); console.log(LOG_PREFIX, 'forceScanModels ejecutado. allModels:', allModels.length); return allModels.length; };
    window.us2_showOverlay = (show) => { overlay.style.display = show ? 'flex' : 'none'; };
    window.us2_setProgress = (n) => {
      const p = Math.max(0, Math.min(100, Math.round(n)));
      progressBar.style.width = p + '%';
      percent.textContent = p + '%';
    };

    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUIInsideScene);
  } else createUIInsideScene();

  // === helpers parse/build OBJ ===
  function parseObj(obj) {
    const primitives = [];
    try {
      const pList = obj._primitives || obj.primitives || [];
      pList.forEach(p => {
        if (!p) return;
        if (p.indices && p.indices._elements) primitives.push({ mode: p.mode, indices: p.indices._elements });
        else if (Array.isArray(p.indices)) primitives.push({ mode: p.mode, indices: p.indices });
      });
    } catch (err) { console.warn(LOG_PREFIX, 'parseObj primitives error', err); }
    const attr = obj._attributes || obj.attributes || {};
    const getElems = key => (attr[key] && attr[key]._elements) ? attr[key]._elements : (attr[key] && attr[key].elements) ? attr[key].elements : [];
    return {
      vertex: getElems('Vertex'),
      normal: getElems('Normal'),
      uv: getElems('TexCoord0').length ? getElems('TexCoord0') : getElems('TexCoord1').length ? getElems('TexCoord1') : [],
      primitives,
    };
  }

  function buildOBJ(mdl) {
    const obj = mdl.obj;
    let str = '';
    str += `mtllib ${mdl.name}.mtl\n`;
    str += `o ${mdl.name}\n`;
    for (let i = 0; i < (obj.vertex || []).length; i += 3) {
      str += 'v ' + (obj.vertex[i] || 0) + ' ' + (obj.vertex[i+1]||0) + ' ' + (obj.vertex[i+2]||0) + '\n';
    }
    for (let i = 0; i < (obj.normal || []).length; i += 3) {
      str += 'vn ' + (obj.normal[i]||0) + ' ' + (obj.normal[i+1]||0) + ' ' + (obj.normal[i+2]||0) + '\n';
    }
    for (let i = 0; i < (obj.uv || []).length; i += 2) {
      str += 'vt ' + (obj.uv[i]||0) + ' ' + (obj.uv[i+1]||0) + '\n';
    }
    str += 's on\n';
    const vn = (obj.normal||[]).length !== 0;
    const vt = (obj.uv||[]).length !== 0;
    (obj.primitives || []).forEach(primitive => {
      if (primitive.mode == 4 || primitive.mode == 5) {
        const strip = (primitive.mode == 5);
        for (let j = 0; j + 2 < primitive.indices.length; !strip ? j += 3 : j++) {
          str += 'f ';
          let order = [0,1,2];
          if (strip && (j % 2 === 1)) order = [0,2,1];
          for (let k = 0; k < 3; ++k) {
            const faceNum = primitive.indices[j + order[k]] + 1;
            str += faceNum;
            if (vn || vt) {
              str += '/';
              if (vt) str += faceNum;
              if (vn) str += '/' + faceNum;
            }
            str += ' ';
          }
          str += '\n';
        }
      }
    });
    return new Blob([str], { type: 'text/plain' });
  }

  // === attachbody robusto (deduplicado) ===
  window.attachbody = function(obj) {
    try {
      if (!obj) return;
      if (obj._faked === true) return;
      const name = obj._name || (obj.attributes && obj.attributes.name) || (obj.name) || 'model';
      const uid = obj._uid || obj.uid || (obj.attributes && obj.attributes.uid) || '';
      const key = name + '|' + uid;
      if (seenModels.has(key)) return;
      const ln = (''+name).toLowerCase();
      if (ln.includes('composer layer') || ln.includes('ground - geometry')) return;
      seenModels.add(key);
      obj._faked = true;
      allModels.push(obj);
      console.log(LOG_PREFIX, 'modelo añadido:', name);
    } catch (err) {
      console.warn(LOG_PREFIX, 'attachbody err', err);
    }
  };

  // === Detección adicional: escanea window para objetos parecidos a modelo ===
  function isMaybeModel(o) {
    if (!o || typeof o !== 'object') return false;
    if (o._primitives || o.primitives) return true;
    if (o._attributes || o.attributes) return true;
    if (o.vertices || o.indices) return true;
    return false;
  }

  function tryScanGlobals(forceLog=false) {
    try {
      const keys = Object.keys(window);
      let found = 0;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        try {
          const val = window[k];
          if (!val) continue;
          if (Array.isArray(val)) {
            for (let j = 0; j < Math.min(80, val.length); j++) {
              const e = val[j];
              if (isMaybeModel(e)) { window.attachbody(e); found++; }
            }
          } else if (typeof val === 'object') {
            if (isMaybeModel(val)) { window.attachbody(val); found++; }
            else {
              for (const p in val) {
                if (!Object.prototype.hasOwnProperty.call(val, p)) continue;
                try {
                  const sub = val[p];
                  if (isMaybeModel(sub)) { window.attachbody(sub); found++; }
                } catch(e){}
              }
            }
          }
        } catch(e){}
      }
      if (forceLog) console.log(LOG_PREFIX, 'tryScanGlobals encontró:', found, 'total allModels:', allModels.length);
      return found;
    } catch (err) {
      console.warn(LOG_PREFIX, 'tryScanGlobals err', err);
      return 0;
    }
  }

  // intentos periódicos al inicio
  (function periodicScan() {
    let attempts = 0;
    const id = setInterval(() => {
      attempts++;
      tryScanGlobals(false);
      if (allModels.length > 0 || attempts > 30) clearInterval(id);
    }, 700);
  })();

  // === parcheo de scripts externos (fetch + reemplazo) ===
  (function patchScripts() {
    const mutateObserver = new MutationObserver(records => {
      for (const m of records) {
        for (const node of m.addedNodes) {
          try {
            if (node.tagName === 'SCRIPT' && node.src) {
              const src = node.src;
              if (/web\/dist|standaloneViewer|viewer|embed|sketchfab/i.test(src)) {
                node.type = 'us2/blocked';
                (async (s) => {
                  try {
                    const r = await fetch(s, { credentials: 'same-origin' });
                    let jstext = await r.text();
                    let ret;
                    ret = func_renderInto1.exec(jstext);
                    if (ret) { const index = ret.index + ret[0].length; jstext = jstext.slice(0,index) + ",i" + jstext.slice(index); }
                    ret = func_renderInto2.exec(jstext);
                    if (ret) { const index = ret.index + ret[0].length; jstext = jstext.slice(0,index) + ",image_data" + jstext.slice(index); }
                    ret = fund_drawArrays.exec(jstext);
                    if (ret) { const index = ret.index + ret[0].length; jstext = jstext.slice(0,index) + ",window.drawhookimg(t,image_data)" + jstext.slice(index); }
                    ret = func_getResourceImage.exec(jstext);
                    if (ret) { const index = ret.index + ret[0].length; jstext = jstext.slice(0,index) + "e = window.drawhookcanvas(e,this._imageModel);" + jstext.slice(index); }
                    ret = func_drawGeometry.exec(jstext);
                    if (ret) {
                      const index1 = ret.index + (ret[1] ? ret[1].length : ret[0].length);
                      jstext = jstext.slice(0,index1) + ";window.attachbody(t);" + jstext.slice(index1);
                    }
                    const script = document.createElement('script');
                    script.type = 'text/javascript';
                    script.text = jstext;
                    document.head.appendChild(script);
                  } catch (err) {
                    node.type = 'text/javascript';
                    console.warn(LOG_PREFIX, 'patchScripts fetch failed', err, src);
                    tryScanGlobals(false);
                  }
                })(src);
              }
            }
          } catch (err) { /* ignore */ }
        }
      }
    });
    mutateObserver.observe(document.documentElement, { childList: true, subtree: true });
  })();

  // === captura de texturas (drawhookcanvas / drawhookimg) ===
  window.drawhookcanvas = function(e, imagemodel) {
    try {
      if (!imagemodel) return e;
      if ((e.width === 128 && e.height === 128) || (e.width === 32 && e.height === 32) || (e.width === 64 && e.height === 64)) return e;
      const alpha = e.options && e.options.format;
      let url_image = e.url;
      let best = e;
      let max_size = 0;
      (imagemodel.attributes && imagemodel.attributes.images || []).forEach(img => {
        const alpha_ok = (alpha === 'A') ? img.options.format === alpha : true;
        let d = img.width || 0;
        while (d % 2 === 0 && d > 1) d = d / 2;
        if (img.size > max_size && alpha_ok && d === 1) {
          max_size = img.size;
          url_image = img.url;
          best = img;
        }
      });
      if (!saveImageCache.has(url_image)) saveImageCache.set(url_image, { name: imagemodel.attributes.name || 'texture' });
      return best;
    } catch (err) {
      return e;
    }
  };

  window.drawhookimg = function(gl, t) {
    try {
      const url = t[5] && t[5].currentSrc;
      const width = t[5] && t[5].width;
      const height = t[5] && t[5].height;
      if (!url || !saveImageCache.has(url)) return;
      const data = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const halfHeight = (height / 2) | 0;
      const bytesPerRow = width * 4;
      const temp = new Uint8Array(width * 4);
      for (let y = 0; y < halfHeight; ++y) {
        const topOffset = y * bytesPerRow;
        const bottomOffset = (height - y - 1) * bytesPerRow;
        temp.set(data.subarray(topOffset, topOffset + bytesPerRow));
        data.copyWithin(topOffset, bottomOffset, bottomOffset + bytesPerRow);
        data.set(temp, bottomOffset);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.createImageData(width, height);
      imageData.data.set(data);
      ctx.putImageData(imageData, 0, 0);
      const meta = saveImageCache.get(url);
      const re = /(?:\.([^.]+))?$/;
      const ext = re.exec(meta.name)[1];
      let baseName = meta.name;
      if (ext && /png|jpe?g/i.test(ext)) baseName = meta.name.replace(new RegExp('\\.' + ext + '$', 'i'), '');
      // asegurar nombre único en objects (evitar colisiones)
      let name = baseName + '.png';
      let suffix = 1;
      while (objects['textures/' + name]) { name = baseName + '_' + (suffix++) + '.png'; }
      canvas.toBlob(blob => { objects['textures/' + name] = blob; console.log(LOG_PREFIX, 'textura guardada:', 'textures/' + name); }, 'image/png');
    } catch (err) {}
  };

  // === flujo de descarga: reintentos de scan, empaquetado, progreso ===
  async function startDownloadFlow() {
    try {
      window.us2_showOverlay(true);
      window.us2_setProgress(6);

      const maxWaitMs = 4000;
      const interval = 400;
      let waited = 0;
      while (allModels.length === 0 && waited < maxWaitMs) {
        tryScanGlobals(false);
        await new Promise(r => setTimeout(r, interval));
        waited += interval;
      }
      window.us2_setProgress(16);

      if (allModels.length === 0) tryScanGlobals(true);
      window.us2_setProgress(26);

      if (allModels.length === 0) {
        console.warn(LOG_PREFIX, 'No se detectaron modelos. Ejecuta window.forceScanModels() o revisa la consola.');
        window.us2_showOverlay(false);
        return;
      }

      for (let i = 0; i < allModels.length; i++) {
        const objRaw = allModels[i];
        const name = (objRaw._name || objRaw.name || `modelo_${i}`).replace(/\s+/g,'_').slice(0,80);
        const keyName = `${name}.obj`;
        if (objects[keyName]) continue;
        const parsed = parseObj(objRaw);
        const blob = buildOBJ({ name, obj: parsed });
        objects[keyName] = blob;
        window.us2_setProgress(26 + Math.min(60, Math.round((i+1)/Math.max(1, allModels.length) * 60)));
        await new Promise(r => setTimeout(r, 60));
      }

      // Empaquetar: metemos texturas dentro de collection/textures/
      const zip = new JSZip();
      const folder = zip.folder('collection');
      // primero archivos raíz (obj, mtl si hubiera)
      Object.keys(objects).forEach(k => {
        // si la key ya contiene 'textures/' la dejamos para el siguiente loop
        if (!k.startsWith('textures/')) {
          folder.file(k, objects[k], { binary: true });
        }
      });
      // ahora las texturas en subcarpeta
      const texFolder = folder.folder('textures');
      Object.keys(objects).forEach(k => {
        if (k.startsWith('textures/')) {
          const short = k.replace(/^textures\//, '');
          texFolder.file(short, objects[k], { binary: true });
        }
      });

      // generar zip con progreso
      const blobZip = await zip.generateAsync({ type: 'blob' }, meta => {
        window.us2_setProgress(90 + Math.round(meta.percent/10));
      });
      window.us2_setProgress(100);

      const titleEl = document.getElementsByClassName('model-name__label')[0];
      const fileName = (titleEl ? titleEl.textContent.trim() : 'sketchfab_collection') + '.zip';
      saveAs(blobZip, fileName);
      setTimeout(()=>{ window.us2_showOverlay(false); window.us2_setProgress(0); }, 900);
      console.log(LOG_PREFIX, 'Descarga iniciada:', fileName);
    } catch (err) {
      console.error(LOG_PREFIX, 'Error en startDownloadFlow', err);
      window.us2_showOverlay(false);
    }
  }

  // status exposible
  window.us2_status = () => ({ models: allModels.length, objects: Object.keys(objects).length });

})();
