
(() => {
  const homeScreen = document.getElementById('homeScreen');
  const scanScreen = document.getElementById('scanScreen');
  const backButton = document.getElementById('backButton');
  const cameraButton = document.getElementById('cameraButton');
  const cameraButtonText = document.getElementById('cameraButtonText');
  const cameraState = document.getElementById('cameraState');
  const cameraPlaceholder = document.getElementById('cameraPlaceholder');
  const statusMessage = document.getElementById('statusMessage');
  const lastScanCard = document.getElementById('lastScanCard');
  const lastBarcode = document.getElementById('lastBarcode');
  const scanList = document.getElementById('scanList');
  const itemCount = document.getElementById('itemCount');
  const connectionStatus = document.getElementById('connectionStatus');
  const sessionTitle = document.getElementById('sessionTitle');
  const inventoryFormCard = document.getElementById('inventoryFormCard');
  const inventoryForm = document.getElementById('inventoryForm');
  const inventoryActionButton = document.getElementById('inventoryActionButton');
  const sellButton = document.getElementById('sellButton');
  const inventoryNotice = document.getElementById('inventoryNotice');
  const originalPriceInput = document.getElementById('originalPrice');
  const priceHint = document.getElementById('priceHint');
  let currentMode = null;
  let cameraRunning = false;
  let scanArmed = true;
  let lastValidDecodeAt = 0;
  let lastCapturedCode = null;
  let scanHintTimer = null;
  let lastUnsupportedCodeMessageAt = 0;
  const sessions = { inbound: [], sell: [] };

  const labels = {
    inbound: {
      eyebrow: 'INBOUND', title: 'Scan incoming products', description: 'Point your camera at one product barcode.',
      badge: 'INBOUND', action: 'INBOUND CAPTURE', color: 'inbound-badge',
    },
    sell: {
      eyebrow: 'SELL', title: 'Scan products to sell', description: 'Scan each product the customer is buying.',
      badge: 'SELL', action: 'SELL CAPTURE', color: 'sell-badge',
    },
  };

  document.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => selectMode(button.dataset.mode));
  });
  backButton.addEventListener('click', goHome);
  cameraButton.addEventListener('click', () => cameraRunning ? stopCamera() : startCamera());
  document.getElementById('clearButton').addEventListener('click', clearSession);
  inventoryActionButton.addEventListener('click', () => {
    inventoryFormCard.classList.remove('hidden');
    document.getElementById('productName').focus();
  });
  inventoryForm.addEventListener('submit', saveInventoryItem);
  sellButton.addEventListener('click', completeSale);
  document.getElementById('manualForm').addEventListener('submit', event => {
    event.preventDefault();
    const input = document.getElementById('manualBarcode');
    void capture(input.value.trim(), 'Manual entry');
    input.value = '';
  });
  document.getElementById('copyButton').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lastBarcode.textContent);
      statusMessage.textContent = 'Barcode copied.';
    } catch {
      statusMessage.textContent = 'Copy is unavailable in this browser. You can select the barcode text.';
    }
  });
  void checkConnection();

  function selectMode(mode) {
    currentMode = mode;
    scanArmed = true;
    lastValidDecodeAt = 0;
    lastCapturedCode = null;
    lastScanCard.classList.add('hidden');
    inventoryFormCard.classList.add('hidden');
    inventoryNotice.classList.add('hidden');
    const config = labels[mode];
    homeScreen.classList.add('hidden');
    scanScreen.classList.remove('hidden');
    document.getElementById('modeEyebrow').innerHTML = `<span class="eyebrow-line"></span> ${config.eyebrow}`;
    document.getElementById('scanTitle').textContent = config.title;
    document.getElementById('scanDescription').textContent = config.description;
    const badge = document.getElementById('modeBadge');
    badge.textContent = config.badge;
    badge.className = `mode-badge ${config.color}`;
    document.getElementById('recordModeLabel').textContent = config.action;
    sessionTitle.textContent = mode === 'sell' ? 'Cart' : 'Received this session';
    inventoryActionButton.classList.toggle('hidden', mode !== 'inbound');
    sellButton.classList.toggle('hidden', mode !== 'sell');
    statusMessage.textContent = 'Camera access starts only when you tap Start camera.';
    cameraState.innerHTML = '<i></i> Ready';
    renderEntries();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function goHome() {
    await stopCamera();
    currentMode = null;
    scanScreen.classList.add('hidden');
    homeScreen.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---- Full-resolution scanner ------------------------------------------------
  // html5-qrcode decodes a tiny downscaled canvas, which destroys the thin bars of
  // EAN/UPC barcodes. Instead we pull full video frames ourselves and decode those.
  let stream = null, videoEl = null, frameCanvas = null, loopTimer = null, loopToken = 0;
  let nativeDetector = null, wasmReady = false;
  let diagEl = null, diagFrames = 0, diagErr = '', diagMs = 0;
  function diag() {
    if (!diagEl) {
      diagEl = document.createElement('div');
      diagEl.style.cssText = 'font:11px/1.4 monospace;color:#9fb3c2;padding:6px 2px;word-break:break-all';
      statusMessage.parentNode.insertBefore(diagEl, statusMessage.nextSibling);
    }
    const v = videoEl;
    diagEl.textContent = 'DIAG ' + (nativeDetector ? 'native-detector' : 'zxing-wasm') +
      ' | video ' + (v ? v.videoWidth + 'x' + v.videoHeight + ' rs' + v.readyState : 'none') +
      ' | frames ' + diagFrames + ' | ' + diagMs + 'ms/frame' + (diagErr ? ' | ERR ' + diagErr : '');
  }

  function onDecoded(decoded) {
    const code = String(decoded || '').trim();
    if (code.length < 4 || code.length > 128 || !/[\p{L}\p{N}]/u.test(code)) {
      const now = Date.now();
      if (now - lastUnsupportedCodeMessageAt > 1800) {
        lastUnsupportedCodeMessageAt = now;
        statusMessage.textContent = 'The camera saw a partial mark. Hold the full barcode steady inside the frame.';
      }
      return;
    }
    lastValidDecodeAt = Date.now();
    // Ignore the same barcode while it stays in view, but accept a new barcode
    // immediately without waiting for a blank frame between products.
    if (scanArmed || code !== lastCapturedCode) {
      scanArmed = false;
      lastCapturedCode = code;
      void capture(code, 'Camera scan');
    }
  }

  function onNoDecode() {
    // Re-arm only after the previous barcode has left the view, so a held item is not recounted.
    if (!scanArmed && Date.now() - lastValidDecodeAt > 450) {
      scanArmed = true;
      lastCapturedCode = null;
      if (cameraRunning) statusMessage.textContent = 'Ready for the next item. Move its barcode into the frame.';
    }
  }

  async function setupDecoder() {
    nativeDetector = null;
    if ('BarcodeDetector' in window) {
      try {
        const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'codabar', 'itf', 'qr_code', 'data_matrix', 'pdf417', 'aztec'];
        const supported = await BarcodeDetector.getSupportedFormats();
        const formats = wanted.filter(f => supported.includes(f));
        if (formats.length) nativeDetector = new BarcodeDetector({ formats });
      } catch (error) { console.warn('Native BarcodeDetector unavailable:', error); }
    }
    if (nativeDetector) return;
    // Modern ZXing-C++ (WebAssembly) decoder for browsers without BarcodeDetector (iPhone Safari).
    if (typeof ZXingWASM === 'undefined') throw new Error('Scanner engine did not load. Refresh the page and try again.');
    if (!wasmReady) {
      const bin = atob(document.getElementById('zxingWasmB64').textContent.trim());
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      ZXingWASM.setZXingModuleOverrides({ wasmBinary: bytes.buffer });
      await ZXingWASM.prepareZXingModule({ fireImmediately: true });
      wasmReady = true;
    }
  }

  function teardownDecoder() {
    nativeDetector = null;
  }

  async function decodeFrame() {
    if (nativeDetector) {
      const results = await nativeDetector.detect(videoEl);
      return results.length ? results[0].rawValue : null;
    }
    // iPhone Safari: decode raw pixels straight from the live video (no image encoding).
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    const scale = Math.min(1, 1280 / Math.max(vw, vh));
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    frameCanvas ||= document.createElement('canvas');
    frameCanvas.width = w; frameCanvas.height = h;
    const ctx = frameCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(videoEl, 0, 0, w, h);
    const results = await ZXingWASM.readBarcodes(ctx.getImageData(0, 0, w, h), {
      formats: ['EAN-13', 'EAN-8', 'UPC-A', 'UPC-E', 'Code128', 'Code39', 'Code93', 'Codabar', 'ITF', 'QRCode', 'DataMatrix', 'PDF417', 'Aztec'],
      tryHarder: true, tryRotate: true, tryInvert: false, maxNumberOfSymbols: 1,
    });
    return results.length ? results[0].text : null;
  }

  function startLoop() {
    const token = ++loopToken;
    const tick = async () => {
      if (token !== loopToken || !cameraRunning) return;
      const started = Date.now();
      try {
        if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth) {
          const t0 = Date.now();
          const text = await decodeFrame();
          diagMs = Date.now() - t0; diagFrames++; diag();
          if (token !== loopToken) return;
          if (text) onDecoded(text); else onNoDecode();
        }
      } catch (error) {
        onNoDecode();
        console.warn('Decode error:', error);
        diagErr = String(error && (error.message || error)).slice(0, 120);
        diag();
      }
      if (token !== loopToken) return;
      const gap = nativeDetector ? 100 : 120;
      loopTimer = setTimeout(tick, Math.max(0, gap - (Date.now() - started)));
    };
    loopTimer = setTimeout(tick, 200);
  }

  async function openStream() {
    const attempts = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
      { video: { facingMode: { ideal: 'environment' } }, audio: false },
      { video: true, audio: false },
    ];
    let lastError;
    for (const constraints of attempts) {
      try { return await navigator.mediaDevices.getUserMedia(constraints); }
      catch (error) {
        lastError = error;
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') break;
      }
    }
    throw lastError;
  }

  async function startCamera() {
    if (cameraRunning) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      statusMessage.textContent = 'Phone camera needs a secure HTTPS website. Use the Vercel address, then allow camera access.';
      return;
    }
    cameraButton.disabled = true;
    cameraButtonText.textContent = 'Starting camera…';
    statusMessage.textContent = 'Waiting for camera permission…';
    backButton.disabled = true;
    try {
      await setupDecoder();
      stream = await openStream();
      const track = stream.getVideoTracks()[0];
      // Ask for continuous autofocus where supported; ignored safely elsewhere.
      try {
        const caps = track.getCapabilities ? track.getCapabilities() : {};
        if (caps.focusMode && caps.focusMode.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
        }
      } catch (focusError) { console.warn('Focus mode not applied:', focusError); }
      videoEl = document.createElement('video');
      videoEl.setAttribute('playsinline', '');
      videoEl.setAttribute('muted', '');
      videoEl.muted = true;
      videoEl.autoplay = true;
      videoEl.srcObject = stream;
      const reader = document.getElementById('reader');
      reader.replaceChildren(videoEl);
      await videoEl.play();
      cameraRunning = true;
      scanArmed = true;
      lastCapturedCode = null;
      cameraButton.classList.add('stop');
      cameraButtonText.textContent = 'Stop camera';
      cameraPlaceholder.classList.add('hidden');
      cameraState.classList.add('on');
      cameraState.innerHTML = '<i></i> Camera on';
      statusMessage.textContent = 'Camera is active. Hold the barcode flat and fill most of the frame.';
      diagFrames = 0; diagErr = ''; diag();
      startLoop();
      clearTimeout(scanHintTimer);
      scanHintTimer = setTimeout(() => {
        if (cameraRunning) {
          statusMessage.textContent = 'No barcode yet? Move 10–15 cm away until the bars look sharp, keep it flat, well lit and fully in view. Avoid in-app browsers (WhatsApp, Instagram) — use Safari or Chrome.';
        }
      }, 7000);
    } catch (error) {
      console.error(error);
      await stopCamera();
      statusMessage.textContent = `Could not start camera${error?.message ? `: ${error.message}` : '. Allow camera permission in your phone browser settings and try again.'}`;
    } finally {
      cameraButton.disabled = false;
      backButton.disabled = false;
    }
  }

  async function stopCamera() {
    clearTimeout(scanHintTimer);
    clearTimeout(loopTimer);
    loopToken++;
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (videoEl) { videoEl.srcObject = null; videoEl.remove(); videoEl = null; }
    teardownDecoder();
    if (diagEl) { diagEl.remove(); diagEl = null; }
    cameraRunning = false;
    scanArmed = true;
    lastValidDecodeAt = 0;
    lastCapturedCode = null;
    cameraButton.classList.remove('stop');
    cameraButtonText.textContent = 'Start camera';
    cameraPlaceholder.classList.remove('hidden');
    cameraState.classList.remove('on');
    cameraState.innerHTML = '<i></i> Camera off';
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Server error (${response.status})`);
    return body;
  }

  async function checkConnection() {
    try {
      await api('/api/dashboard');
      connectionStatus.classList.remove('db-offline');
      connectionStatus.innerHTML = '<i></i> SQL CONNECTED';
    } catch {
      connectionStatus.classList.add('db-offline');
      connectionStatus.innerHTML = '<i></i> SQL DISCONNECTED';
    }
  }

  function todayLocal() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  async function capture(rawCode, source) {
    const code = String(rawCode || '').trim();
    if (!code || !currentMode) return;
    clearTimeout(scanHintTimer);
    lastBarcode.textContent = code;
    lastScanCard.classList.remove('hidden');
    document.getElementById('scanTime').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (navigator.vibrate) navigator.vibrate(60);
    if (currentMode === 'inbound') {
      inventoryForm.reset();
      document.getElementById('inventoryBarcode').value = code;
      document.getElementById('receiveQuantity').value = '1';
      document.getElementById('unitCost').value = '';
      document.getElementById('arrivalDate').value = todayLocal();
      originalPriceInput.readOnly = false;
      priceHint.textContent = 'This sale price is saved once and kept unchanged.';
      inventoryNotice.classList.add('hidden');
      inventoryFormCard.classList.add('hidden');
      statusMessage.textContent = `${source}: tap “Add to inventory” to enter the goods details.`;
      try {
        const { product } = await api(`/api/inventory?barcode=${encodeURIComponent(code)}`);
        if (document.getElementById('inventoryBarcode').value !== code) return;
        if (product) {
          document.getElementById('productName').value = product.name;
          originalPriceInput.value = product.originalPrice;
          originalPriceInput.readOnly = true;
          priceHint.textContent = 'Sale price is already set and stays unchanged. Enter the cost for this new delivery.';
        }
      } catch (error) {
        showNotice(`SQL database is not connected yet: ${error.message}`, 'error');
        statusMessage.textContent = `Barcode captured, but database lookup failed: ${error.message}`;
      }
      return;
    }

    let cartItem = sessions.sell.find(item => item.code === code);
    if (cartItem) {
      cartItem.quantity += 1;
      cartItem.time = new Date();
    } else {
      cartItem = {
        code, name: 'Checking inventory…', quantity: 1, originalPrice: null,
        available: null, lookupState: 'checking', time: new Date(),
      };
      sessions.sell.unshift(cartItem);
    }
    cartItem.lookupState = 'checking';
    renderEntries();
    statusMessage.textContent = `${source}: ${code} added to cart. Checking its price and stock…`;
    try {
      const { product } = await api(`/api/inventory?barcode=${encodeURIComponent(code)}`);
      if (!product) {
        cartItem.name = 'Not in inventory';
        cartItem.lookupState = 'missing';
        statusMessage.textContent = `Barcode ${code} is in the cart but is not in inventory. Receive it in Inbound before selling.`;
        renderEntries();
        return;
      }
      cartItem.name = product.name;
      cartItem.originalPrice = Number(product.originalPrice);
      cartItem.available = Number(product.quantity);
      if (product.unitCost === null) {
        cartItem.lookupState = 'missing_cost';
        statusMessage.textContent = `Purchase cost is missing for ${product.name}. Add the cost in Inbound before selling.`;
      } else {
        cartItem.lookupState = cartItem.quantity <= cartItem.available ? 'ready' : 'insufficient';
        statusMessage.textContent = cartItem.lookupState === 'ready'
          ? `${product.name} is in the cart at its original price.`
          : `Only ${product.quantity} ${product.name} in stock; reduce the cart quantity before selling.`;
      }
      renderEntries();
    } catch (error) {
      cartItem.name = 'Inventory lookup failed';
      cartItem.lookupState = 'error';
      statusMessage.textContent = `${code} remains in the cart, but inventory lookup failed: ${error.message}`;
      renderEntries();
    }
  }

  async function saveInventoryItem(event) {
    event.preventDefault();
    const submit = document.getElementById('saveInventoryButton');
    submit.disabled = true;
    submit.textContent = 'Saving…';
    const item = {
      barcode: document.getElementById('inventoryBarcode').value.trim(),
      name: document.getElementById('productName').value.trim(),
      quantity: Number(document.getElementById('receiveQuantity').value),
      originalPrice: Number(originalPriceInput.value),
      unitCost: Number(document.getElementById('unitCost').value),
      arrivalDate: document.getElementById('arrivalDate').value,
      supplierName: document.getElementById('supplierName').value.trim(),
    };
    try {
      const { product, receipt } = await api('/api/inventory', {
        method: 'POST', body: JSON.stringify(item),
      });
      sessions.inbound.unshift({
        code: product.barcode, name: product.name, quantity: Number(receipt.quantity),
        originalPrice: Number(product.originalPrice), supplier: receipt.supplierName,
        time: new Date(),
      });
      inventoryFormCard.classList.add('hidden');
      statusMessage.textContent = `${product.name} added to inventory. Stock is now ${product.quantity}.`;
      renderEntries();
    } catch (error) {
      showNotice(`Could not save to SQL: ${error.message}`, 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Add to inventory';
    }
  }

  async function completeSale() {
    if (!sessions.sell.length) return;
    if (sessions.sell.some(item => item.lookupState !== 'ready')) {
      statusMessage.textContent = 'Resolve every cart item against inventory before selling.';
      return;
    }
    sellButton.disabled = true;
    sellButton.textContent = 'Processing…';
    try {
      const { sale } = await api('/api/sales', {
        method: 'POST',
        body: JSON.stringify({ items: sessions.sell.map(item => ({ barcode: item.code, quantity: item.quantity })) }),
      });
      sessions.sell = [];
      statusMessage.textContent = `Sale #${sale.id} completed. Inventory has been reduced.`;
      renderEntries();
    } catch (error) {
      statusMessage.textContent = `Sale was not completed: ${error.message}`;
    } finally {
      sellButton.disabled = false;
      sellButton.textContent = 'Sell';
    }
  }

  function showNotice(message, kind = 'info') {
    inventoryNotice.textContent = message;
    inventoryNotice.className = `workflow-notice ${kind}`;
  }

  function renderEntries() {
    const entries = currentMode ? sessions[currentMode] : [];
    scanList.replaceChildren();
    const total = entries.reduce((sum, entry) => sum + entry.quantity, 0);
    itemCount.textContent = total;
    if (sellButton) sellButton.disabled = entries.length === 0 || entries.some(item => item.lookupState !== 'ready');
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'list-empty';
      empty.innerHTML = currentMode === 'sell'
        ? '<span>▤</span><b>Cart is empty</b><small>Scan an item already in inventory to add it here.</small>'
        : '<span>▤</span><b>No receipts yet</b><small>Scanned items appear after you add them to inventory.</small>';
      scanList.append(empty);
      return;
    }
    entries.forEach((entry, index) => {
      const row = document.createElement('div'); row.className = 'scan-row';
      const number = document.createElement('span'); number.className = 'row-index'; number.textContent = String(entries.length - index).padStart(2, '0');
      const code = document.createElement('span'); code.className = 'row-product';
      const name = document.createElement('b'); name.textContent = entry.name || entry.code;
      const barcode = document.createElement('code'); barcode.className = 'row-code'; barcode.textContent = entry.code;
      code.append(name, barcode);
      const quantity = document.createElement('span'); quantity.className = 'row-count';
      quantity.textContent = currentMode === 'sell'
        ? entry.lookupState === 'ready'
          ? `× ${entry.quantity} · ${entry.originalPrice.toFixed(2)} each`
          : entry.lookupState === 'insufficient'
            ? `× ${entry.quantity} · only ${entry.available} available`
            : `× ${entry.quantity} · ${entry.lookupState === 'checking' ? 'checking…' : entry.lookupState === 'missing' ? 'not in stock' : entry.lookupState === 'missing_cost' ? 'cost required' : 'retry scan'}`
        : `+ ${entry.quantity}`;
      const time = document.createElement('time'); time.className = 'row-time'; time.textContent = entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      row.append(number, code, quantity, time); scanList.append(row);
    });
  }

  function clearSession() {
    if (currentMode) sessions[currentMode] = [];
    lastScanCard.classList.add('hidden');
    inventoryFormCard.classList.add('hidden');
    statusMessage.textContent = 'Session scan list cleared.';
    renderEntries();
  }

})();
