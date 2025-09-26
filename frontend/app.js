(function () {
  'use strict';

  const STORAGE_KEY = 'soullens_history_v1';

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.from(document.querySelectorAll(sel)); }

  function fmtTime(ts = Date.now()) {
    const d = new Date(ts);
    return d.toLocaleString();
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function saveHistoryArray(arr) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr || []));
  }
  function loadHistoryArray() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Failed parse history', e);
      return [];
    }
  }

  /* ========== DOM references ========== */
  const taskbar = $('#taskbar');
  const openTaskBtn = $('#openTaskBtn');
  const taskToggleBtn = $('#taskToggleBtn');
  const themeBtn = $('#themeBtn');
  const brightnessRange = $('#brightness');

  const chatInput = $('#chatInput');
  const sendChatBtn = $('#sendChat');
  const messagesEl = $('#messages');
  const chatStatus = $('#chatStatus');

  const imgInput = $('#imgInput');
  const imgPreview = $('#imgPreview');
  const analyzeImgBtn = $('#analyzeImgBtn');
  const clearImgBtn = $('#clearImgBtn');
  const imgResult = $('#imgResult');

  const audioInput = $('#audioInput');
  const audioPlayer = $('#audioPlayer');
  const analyzeAudioBtn = $('#analyzeAudioBtn');
  const clearAudioBtn = $('#clearAudioBtn');
  const audioResult = $('#audioResult');

  const lastResult = $('#lastResult');
  const historyEl = $('#history');
  const clearHistoryBtn = $('#clearHistory');
  const actionTipsEl = $('#actionTips');

  const toastEl = $('#toast');

  /* ========== UI helpers ========== */
  function setChatStatus(text) {
    chatStatus.textContent = `Status: ${text}`;
  }

  // Toast (global, used by inline onclick in HTML)
  window.showToast = function showToast(message, timeout = 3500) {
    toastEl.textContent = message;
    toastEl.style.display = 'block';
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translateY(0)';
    if (showToast._timer) clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(8px)';
      setTimeout(() => toastEl.style.display = 'none', 300);
    }, timeout);
  };

  // Demo mode toggle (global, used by inline onclick)
  window.toggleDemoMode = function toggleDemoMode() {
    document.body.classList.toggle('demo-mode');
    const is = document.body.classList.contains('demo-mode');
    showToast(is ? 'Chế độ demo: ON — Mô phỏng kết quả' : 'Chế độ demo: OFF');
    // If demo on and no history, add sample item
    if (is && loadHistoryArray().length === 0) {
      const sample = {
        id: 'sample-1',
        type: 'chat',
        input: 'Hôm nay mình thấy hơi chán, không muốn làm gì cả.',
        result: generateSoulResponse('Hôm nay mình thấy hơi chán, không muốn làm gì cả.'),
        ts: Date.now()
      };
      const arr = [sample].concat(loadHistoryArray());
      saveHistoryArray(arr);
      renderHistory();
    }
  };

  /* ========== Taskbar, theme, brightness ========= */
  openTaskBtn.addEventListener('click', () => {
    taskbar.classList.toggle('hidden');
  });
  if (taskToggleBtn) {
    taskToggleBtn.addEventListener('click', () => {
      taskbar.classList.add('hidden');
    });
  }

  themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark');
    const dark = document.body.classList.contains('dark');
    themeBtn.textContent = dark ? '☀️' : '🌙';
    showToast(dark ? 'Đã chuyển sang giao diện tối' : 'Đã chuyển sang giao diện sáng');
  });

  brightnessRange.addEventListener('input', (e) => {
    const val = e.target.value;
    const appEl = $('#root');
    if (appEl) appEl.style.filter = `brightness(${val}%)`;
  });

  /* ========== Chat functionality ========== */

  // Append message to messages panel
  function appendMessage(who = 'assistant', text = '', emoji = '') {
    const div = document.createElement('div');
    div.className = 'msg' + (who === 'you' ? ' you' : '');

    const metaDiv = document.createElement('div');
    metaDiv.className = 'msg-meta';
    metaDiv.textContent = who === 'you' ? 'You' : 'Assistant';
    if (emoji) {
      metaDiv.innerHTML += ` <span class="emoji-icon">${emoji}</span>`;
    }

    const textDiv = document.createElement('div');
    textDiv.className = 'msg-text';
    textDiv.textContent = text;
    
    div.appendChild(metaDiv);
    div.appendChild(textDiv);
    messagesEl.appendChild(div);

    // scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight + 100;
  }

  // Get emoji based on mood
  function getMoodEmoji(mood) {
    switch (mood) {
      case 'happy': return '😊';
      case 'sad': return '😔';
      case 'angry': return '😤';
      case 'anxious': return '😟';
      case 'curious': return '🤔';
      case 'neutral': return '😐';
      default: return '';
    }
  }

  // Detect simple mood from user text (keyword-based)
  function detectMood(text = '') {
    const s = text.toLowerCase();
    const happy = ['vui', 'vui vẻ', 'tuyệt', 'tốt', 'vui quá', 'vui', 'yeah', 'hạnh phúc', 'vui sướng', 'ngon'];
    const sad = ['buồn', 'chán', 'mệt', 'tuyệt vọng', 'cô đơn', 'khóc', 'đau', 'stress', 'mệt mỏi'];
    const angry = ['giận', 'bực', 'phẫn nộ', 'tức', 'ghét'];
    const anxious = ['lo', 'lo lắng', 'bồn chồn', 'hồi hộp', 'áp lực'];

    if (happy.some(k => s.includes(k))) return 'happy';
    if (sad.some(k => s.includes(k))) return 'sad';
    if (angry.some(k => s.includes(k))) return 'angry';
    if (anxious.some(k => s.includes(k))) return 'anxious';
    // detect question with "?" maybe confused/curious
    if (s.includes('?')) return 'curious';
    return 'neutral';
  }

  // Generate empathetic 3-5 sentences response (Vietnamese),
  // Always returns at least 3 sentences, up to 5.
  function generateSoulResponse(userText = '') {
    const mood = detectMood(userText);
    const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
    // sentence pools per mood
    const pools = {
      happy: [
        "Nghe giọng bạn là mình thấy vui lây — thật tuyệt khi bạn đang có khoảnh khắc tốt đẹp.",
        "Hãy tận hưởng điều đó, ghi lại vài điều khiến bạn mỉm cười hôm nay để giữ cảm xúc tích cực lâu hơn.",
        "Nếu muốn chia sẻ thêm, mình rất thích nghe câu chuyện đó — kể cho mình nghe nhé.",
        "Những phút giây hạnh phúc nhỏ nhoi cũng quan trọng, mình luôn ở đây để ăn mừng cùng bạn."
      ],
      sad: [
        "Mình nghe thấy bạn đang buồn và mình rất đồng cảm — mệt mỏi, chán nản đôi khi đến tự nhiên như vậy mà.",
        "Hãy cho phép bản thân nghỉ ngơi, đôi khi một tách trà ấm hoặc vài phút đi dạo cũng giúp nhẹ lòng hơn.",
        "Nếu bạn muốn, thử viết ra một điều nhỏ đã làm được hôm nay — nó có thể giúp bạn nhìn nhận khác đi.",
        "Mình ở đây để lắng nghe, bạn không cần phải đối diện mọi chuyện một mình."
      ],
      angry: [
        "Mình cảm nhận được sự bực bội trong lời bạn, điều đó rất thật và hoàn toàn có cơ sở.",
        "Khi tức giận, thử hít thở sâu vài lần, hoặc bước ra ngoài vài phút để làm dịu cơ thể.",
        "Ghi ra điều khiến bạn khó chịu cũng là cách để giải tỏa và tìm hướng xử lý nhẹ nhàng hơn.",
        "Mình sẵn sàng nghe chi tiết nếu bạn muốn trút bầu tâm sự — mình ở đây vì bạn."
      ],
      anxious: [
        "Cảm giác lo lắng có thể làm mọi thứ trở nên nặng nề, và mình hiểu điều đó rất rõ.",
        "Thử hạ nhịp thở: hít 4 giây, thở ra 6 giây, lặp lại vài lần — nó thường giúp ổn định khá nhanh.",
        "Nếu áp lực đến từ một việc cụ thể, chia nhỏ nhiệm vụ thành bước nhỏ cũng giúp bạn thấy dễ chịu hơn.",
        "Mình luôn sẵn lòng đồng hành, bạn có thể nói tiếp để mình cùng suy nghĩ hướng giải quyết."
      ],
      curious: [
        "Câu hỏi hay quá — mình rất vui khi được thảo luận với bạn.",
        "Nếu bạn muốn, mình có thể giải thích rõ hơn, đưa ví dụ hoặc gợi ý từng bước.",
        "Hãy nói rõ hơn một chút để mình hỗ trợ thật cụ thể nhé.",
        "Mình ở đây để đồng hành cùng bạn trong hành trình học hỏi."
      ],
      neutral: [
        "Mình lắng nghe bạn, cảm ơn vì đã chia sẻ những lời vừa rồi.",
        "Nếu bạn muốn, mình có thể gợi ý một vài bước nhỏ để tốt hơn hoặc cùng bạn khám phá cảm xúc đó.",
        "Hãy cho mình biết bạn muốn mình đồng cảm, gợi ý hành động, hay chỉ cần một người lắng nghe.",
        "Mình luôn ở đây, sẵn sàng đồng hành cùng bạn qua những lúc nhẹ nhàng hay khó khăn."
      ]
    };

    // choose 3-5 unique sentences from selected pool (or mix pools if needed)
    const pool = pools[mood] || pools.neutral;
    const count = 3 + Math.floor(Math.random() * 3); // 3..5
    const chosen = [];
    // Ensure variety: shuffle and pick first count
    const copy = pool.slice();
    while (chosen.length < count) {
      if (copy.length === 0) {
        // fallback: add neutral sentence
        copy.push(...pools.neutral);
      }
      const idx = Math.floor(Math.random() * copy.length);
      chosen.push(copy.splice(idx, 1)[0]);
    }

    // join with spaces, friendly tone
    return chosen.join(' ');
  }

  // Send chat message handler
  async function handleSendChat() {
    const text = chatInput.value.trim();
    if (!text) {
      showToast('Gõ gì đó vào ô chat rồi nhấn Gửi nha :)');
      return;
    }

    const mood = detectMood(text);
    const emoji = getMoodEmoji(mood);

    // Append user message with emoji
    appendMessage('you', text, emoji);
    chatInput.value = '';
    setChatStatus('Đang nghĩ...');

    // Save user message to history as pending
    const hist = loadHistoryArray();
    const id = 'chat-' + Date.now();
    const placeholder = {
      id,
      type: 'chat',
      input: text,
      result: null,
      ts: Date.now()
    };
    saveHistoryArray([placeholder].concat(hist));
    renderHistory();

    // Simulate short thinking delay (but produce immediate empathetic reply)
    await new Promise(r => setTimeout(r, 600 + Math.random() * 600));

    const reply = generateSoulResponse(text);
    // Append assistant reply (we'll do a simple typing animation)
    await streamAssistantReply(reply);
    setChatStatus('Ready');

    // update latest history entry (replace placeholder)
    const arr2 = loadHistoryArray();
    // find placeholder by id and replace
    const idx = arr2.findIndex(x => x.id === id);
    if (idx !== -1) {
      arr2[idx].result = reply;
      arr2[idx].ts = Date.now();
      saveHistoryArray(arr2);
      renderHistory();
    }
  }

  // A simple "typewriter" display for assistant reply
  function streamAssistantReply(fullText) {
    return new Promise(resolve => {
      // Create message node with empty text then fill progressively
      const div = document.createElement('div');
      div.className = 'msg';

      const metaDiv = document.createElement('div');
      metaDiv.className = 'msg-meta';
      metaDiv.textContent = 'Assistant';

      const textDiv = document.createElement('div');
      textDiv.className = 'msg-text';

      div.appendChild(metaDiv);
      div.appendChild(textDiv);
      messagesEl.appendChild(div);

      messagesEl.scrollTop = messagesEl.scrollHeight + 100;

      let i = 0;
      const speed = 12 + Math.floor(Math.random() * 10); // ms per char
      const timer = setInterval(() => {
        i += 1;
        textDiv.textContent = fullText.slice(0, i);
        messagesEl.scrollTop = messagesEl.scrollHeight + 100;
        if (i >= fullText.length) {
          clearInterval(timer);
          resolve();
        }
      }, speed);
    });
  }

  sendChatBtn.addEventListener('click', handleSendChat);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSendChat();
    }
  });

  /* ========== Image analysis (client-side heuristics) ========== */

  // Image input preview
  imgInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) {
      clearImagePreview();
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const url = ev.target.result;
      imgPreview.innerHTML = `<img src="${url}" alt="preview" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
      imgPreview.dataset.dataurl = url;
      imgResult.textContent = '';
    };
    reader.readAsDataURL(f);
  });

  function clearImagePreview() {
    imgPreview.innerHTML = 'Chưa có ảnh';
    delete imgPreview.dataset.dataurl;
    imgInput.value = '';
    imgResult.textContent = '';
  }
  clearImgBtn.addEventListener('click', () => {
    clearImagePreview();
    showToast('Ảnh đã được xóa khỏi vùng Preview');
  });

  // Analyze image: draw to canvas and compute average luminance & saturation
  analyzeImgBtn.addEventListener('click', async () => {
    const url = imgPreview.dataset.dataurl;
    if (!url) {
      showToast('Chưa có ảnh để phân tích');
      return;
    }
    setChatStatus('Đang phân tích ảnh...');
    showToast('Đang phân tích ảnh — mô phỏng kết quả demo');
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('Không thể load ảnh'));
      });

      // draw smaller canvas for speed
      const w = Math.min(200, img.width);
      const h = Math.round((img.height / img.width) * w);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      const imgData = ctx.getImageData(0, 0, w, h);
      const { avgLum, avgSat } = analyzeImageData(imgData);

      // heuristics to map to emotions
      const emotions = [];
      // Normalize lum[0..255] -> 0..1
      const lumN = avgLum / 255;
      const satN = avgSat; // already 0..1

      if (lumN > 0.7 && satN > 0.45) {
        emotions.push({ name: 'Vui vẻ', emoji: '😊', confidence: Math.round(50 + (lumN + satN) * 25) });
        emotions.push({ name: 'Tự tin', emoji: '😌', confidence: Math.round(30 + satN * 30) });
      } else if (lumN > 0.5) {
        emotions.push({ name: 'Bình thường', emoji: '🙂', confidence: Math.round(40 + lumN * 30) });
        emotions.push({ name: 'Bình yên', emoji: '🌤️', confidence: Math.round(30 + satN * 30) });
      } else if (lumN <= 0.5 && satN < 0.35) {
        emotions.push({ name: 'Buồn', emoji: '😔', confidence: Math.round(45 + (0.6 - lumN) * 40) });
        emotions.push({ name: 'Trầm tư', emoji: '🤔', confidence: Math.round(25 + (0.35 - satN) * 40) });
      } else {
        emotions.push({ name: 'Cảm xúc phức tạp', emoji: '🤷‍♂️', confidence: Math.round(35 + (0.5 - lumN + satN) * 40) });
        emotions.push({ name: 'Hứng thú', emoji: '✨', confidence: Math.round(20 + satN * 50) });
      }

      const resultObj = {
        id: 'img-' + Date.now(),
        type: 'image',
        inputName: imgInput.files && imgInput.files[0] ? imgInput.files[0].name : 'Ảnh',
        ts: Date.now(),
        meta: { avgLum: Math.round(avgLum), avgSat: Math.round(avgSat * 100) },
        emotions
      };

      displayResult(resultObj);
      // save to history
      const hist2 = loadHistoryArray();
      saveHistoryArray([resultObj].concat(hist2));
      renderHistory();
      setChatStatus('Ready');
      showToast('Phân tích ảnh hoàn tất (mô phỏng).');
    } catch (err) {
      console.error(err);
      showToast('Lỗi khi phân tích ảnh: ' + err.message);
      setChatStatus('Ready');
    }
  });

  // compute average luminance and approximate saturation
  function analyzeImageData(imgData) {
    const data = imgData.data;
    let rAcc = 0, gAcc = 0, bAcc = 0;
    let lumAcc = 0;
    let total = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      rAcc += r; gAcc += g; bAcc += b;
      // luminance formula
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumAcc += lum;
      total += 1;
    }
    const avgR = rAcc / total;
    const avgG = gAcc / total;
    const avgB = bAcc / total;
    const avgLum = lumAcc / total;

    // approximate saturation by mean of (max-min)/max per pixel on sample
    // We'll sample every Nth pixel for speed
    let satSum = 0, satCount = 0;
    const step = 4 * 6; // sample every 6th pixel
    for (let i = 0; i < data.length; i += step) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      satSum += sat;
      satCount += 1;
    }
    const avgSat = satCount ? satSum / satCount : 0;
    return { avgLum, avgSat };
  }

  /* ========== Audio analysis (client-side heuristics) ========== */
  audioInput.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) {
      audioPlayer.style.display = 'none';
      audioPlayer.src = '';
      audioResult.textContent = '';
      return;
    }
    audioPlayer.src = URL.createObjectURL(f);
    audioPlayer.style.display = 'block';
    audioResult.textContent = '';
  });

  clearAudioBtn.addEventListener('click', () => {
    audioInput.value = '';
    audioPlayer.src = '';
    audioPlayer.style.display = 'none';
    audioResult.textContent = '';
    showToast('Audio đã xóa');
  });

  analyzeAudioBtn.addEventListener('click', async () => {
    const f = audioInput.files && audioInput.files[0];
    if (!f) {
      showToast('Chưa chọn file audio để phân tích');
      return;
    }
    setChatStatus('Đang phân tích audio...');
    showToast('Đang phân tích âm thanh — mô phỏng kết quả');
    try {
      const arrayBuffer = await f.arrayBuffer();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Trình duyệt không hỗ trợ Web Audio API');
      }
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      // take first channel
      const ch = decoded.numberOfChannels > 0 ? decoded.getChannelData(0) : null;
      if (!ch) throw new Error('Không thể đọc dữ liệu audio');
      const rms = computeRMS(ch);
      const zcr = computeZCR(ch);
      const dur = decoded.duration;

      // heuristics
      const emotions = [];
      if (rms > 0.06 || zcr > 0.18) {
        emotions.push({ name: 'Năng nổ / Cáu kỉnh', emoji: '⚡', confidence: Math.round(50 + Math.min(40, (rms - 0.06) * 400)) });
        emotions.push({ name: 'Nóng nảy', emoji: '😤', confidence: Math.round(20 + zcr * 200) });
      } else if (rms < 0.03) {
        emotions.push({ name: 'Buồn / Êm đềm', emoji: '😔', confidence: Math.round(40 + (0.03 - rms) * 1000) });
        emotions.push({ name: 'Bình yên', emoji: '🕊️', confidence: Math.round(20 + (1 - zcr) * 50) });
      } else {
        emotions.push({ name: 'Trung tính / Bình thường', emoji: '🙂', confidence: Math.round(40 + rms * 200) });
        emotions.push({ name: 'Lo lắng nhẹ', emoji: '😟', confidence: Math.round(20 + zcr * 120) });
      }

      const resultObj = {
        id: 'aud-' + Date.now(),
        type: 'audio',
        inputName: f.name,
        ts: Date.now(),
        meta: { rms: Math.round(rms * 1000) / 1000, zcr: Math.round(zcr * 1000) / 1000, duration: Math.round(dur * 10) / 10 },
        emotions
      };

      displayResult(resultObj);
      const hist = loadHistoryArray();
      saveHistoryArray([resultObj].concat(hist));
      renderHistory();
      setChatStatus('Ready');
      showToast('Phân tích audio hoàn tất (mô phỏng).');
    } catch (err) {
      console.error(err);
      showToast('Lỗi khi phân tích audio: ' + err.message);
      setChatStatus('Ready');
    }
  });

  function computeRMS(samples) {
    let sum = 0;
    const N = samples.length;
    for (let i = 0; i < N; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / N);
  }

  function computeZCR(samples) {
    let z = 0;
    for (let i = 1; i < samples.length; i++) {
      if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) z++;
    }
    return z / samples.length;
  }

  /* ========== Display result & history ========= */

  function clearLastResultUI() {
    lastResult.innerHTML = '';
    actionTipsEl.textContent = '';
  }

  function displayResult(resultObj) {
    // resultObj: { id, type: 'chat'|'image'|'audio', inputName?, ts, meta?, emotions: [{name, emoji, confidence}] , result? (for chat) }
    clearLastResultUI();

    // show emoji small cards
    resultObj.emotions = resultObj.emotions || [];
    for (const em of resultObj.emotions) {
      const nod = document.createElement('div');
      nod.className = 'emotion-card card';
      nod.style.display = 'flex';
      nod.style.alignItems = 'center';
      nod.style.gap = '12px';
      nod.innerHTML = `
        <div class="emotion-icon" style="font-size:26px;padding:10px;border-radius:8px;background:linear-gradient(135deg,rgba(0,0,0,0.03),rgba(0,0,0,0.01))">${em.emoji}</div>
        <div style="flex:1">
          <div style="font-weight:700">${em.name}</div>
          <div class="muted small">${em.confidence}% tự tin</div>
        </div>
      `;
      lastResult.appendChild(nod);
    }

    // show meta info
    const metaDiv = document.createElement('div');
    metaDiv.className = 'muted small';
    metaDiv.style.marginTop = '8px';
    metaDiv.textContent = `Nguồn: ${resultObj.inputName || 'Chat'} • ${fmtTime(resultObj.ts)} • ${resultObj.type.toUpperCase()}`;
    lastResult.appendChild(metaDiv);

    // action tips (healing tone)
    const tips = generateActionTips(resultObj);
    actionTipsEl.innerHTML = tips;
  }

  // Generate friendly action tips based on result
  function generateActionTips(resultObj) {
    // For chat: resultObj.result contains the assistant reply text
    if (resultObj.type === 'chat') {
      const text = resultObj.result || generateSoulResponse(resultObj.input || '');
      // Make it personal and healing
      return `<div>${text}</div>`;
    }

    // For image / audio: synthesize gentle suggestions
    const top = resultObj.emotions && resultObj.emotions[0];
    let mood = top ? top.name : 'Cảm xúc';
    // friendly tips
    const tipsMap = {
      'Vui vẻ': [
        'Bạn đang có một khoảnh khắc tốt — hãy ghi lại điều này bằng vài dòng nhật ký để giữ cảm xúc đẹp.',
        'Chia sẻ niềm vui với ai đó thân quen có thể nhân đôi năng lượng tích cực đó.'
      ],
      'Tự tin': [
        'Tự tin là một tài sản tuyệt vời — nhớ tận dụng nó cho những việc bạn muốn hoàn thành hôm nay.',
        'Một hành động nhỏ đúng sẽ củng cố cảm giác tự tin hơn.'
      ],
      'Bình thường': [
        'Nếu bạn cảm thấy trung tính, đó cũng là trạng thái bình an — cho phép mình nghỉ ngơi.',
        'Bạn có thể thử một hoạt động nhỏ (nhạc nhẹ, trà) để thêm chút ấm áp cho ngày.'
      ],
      'Buồn': [
        'Mình thấy có chút buồn trong giọng/ảnh — hãy nhẹ nhàng với bản thân nhé.',
        'Thử gọi cho một người bạn tin cậy hoặc viết ra suy nghĩ — nó giúp giảm gánh nặng tâm lý.',
        'Nếu cảm xúc nặng kéo dài, cân nhắc chia sẻ với người thân hoặc chuyên gia.'
      ],
      'Trầm tư': [
        'Thời gian yên lặng để suy ngẫm đôi khi là điều tốt, nhưng đừng để mình cô độc quá lâu.',
        'Một hoạt động nhẹ như đi dạo hoặc nghe bản nhạc nhẹ có thể giúp bạn cân bằng.'
      ],
      'Năng nổ / Cáu kỉnh': [
        'Bạn đang có năng lượng dư — hãy dùng nó cho việc thể chất như chạy bộ ngắn hoặc nhảy vài bài.',
        'Nếu cảm thấy cáu kỉnh, hít thở sâu vài lần để hạ nhiệt trước khi phản ứng.'
      ],
      'Nóng nảy': [
        'Bạn có thể cần chút không gian để hạ nhiệt — rời khỏi tình huống vài phút là một cách tốt.',
        'Ghi ra điều khiến bạn khó chịu có thể giúp nhìn rõ và xử lý nhẹ nhàng hơn.'
      ],
      'Trung tính / Bình thường': [
        'Trung tính cũng ổn — nếu muốn tăng sắc thái cảm xúc, thử một hoạt động nhỏ yêu thích.',
        'Bạn có thể dùng thời gian này để nạp lại năng lượng cho những việc quan trọng.'
      ],
      'Lo lắng nhẹ': [
        'Lo lắng là phản ứng tự nhiên — thử hạ nhịp thở và tập trung vào một việc nhỏ trước mắt.',
        'Chia nhỏ nhiệm vụ, viết checklist, và chúc mừng bản thân khi xong từng bước.'
      ],
      'Cảm xúc phức tạp': [
        'Khi cảm xúc phức tạp, đừng ép mình phân loại ngay — hãy cho phép mọi thứ tồn tại một lúc.',
        'Viết nhật ký vô tư (không phải để chia sẻ) có thể giúp bạn hiểu rõ hơn.'
      ],
      'Hứng thú': [
        'Khoảnh khắc hứng thú rất quý — hãy tận dụng để bắt đầu một việc nhỏ bạn đã ấp ủ.',
        'Ghi lại ý tưởng ngay để không bỏ lỡ nguồn cảm hứng.'
      ]
    };

    const chosen = tipsMap[mood] || ['Mình ở đây để đồng hành cùng bạn.', 'Bạn có thể thử một hành động nhỏ để thử thay đổi cảm xúc.'];
    // join into friendly paragraph
    const parag = chosen.map(s => `<div style="margin-bottom:6px">${s}</div>`).join('');
    // include meta diagnostics
    const meta = resultObj.meta ? `<div class="muted small" style="margin-top:6px">Chi tiết: ${Object.entries(resultObj.meta).map(([k,v]) => `${k}=${v}`).join(' • ')}</div>` : '';
    return parag + meta;
  }

  /* ========== History rendering ========== */
  function renderHistory() {
    const arr = loadHistoryArray();
    historyEl.innerHTML = '';
    if (!arr || arr.length === 0) {
      historyEl.innerHTML = `<div class="muted small">Không có lịch sử.</div>`;
      return;
    }
    for (const it of arr) {
      const item = document.createElement('div');
      item.className = 'card';
      item.style.padding = '8px';
      item.style.cursor = 'pointer';
      item.style.display = 'flex';
      item.style.justifyContent = 'space-between';
      item.style.alignItems = 'center';
      const left = document.createElement('div');
      left.innerHTML = `<div style="font-weight:700">${it.type.toUpperCase()} ${it.inputName ? '• ' + it.inputName : ''}</div>
                       <div class="muted small">${it.type === 'chat' ? it.input : (it.emotions && it.emotions[0] ? it.emotions[0].name : '')}</div>`;
      const right = document.createElement('div');
      right.className = 'muted small';
      right.textContent = fmtTime(it.ts);
      item.appendChild(left);
      item.appendChild(right);

      item.addEventListener('click', () => {
        // show the item in lastResult / messages
        if (it.type === 'chat') {
          // show chat in messages: user message + assistant reply
          const userMood = detectMood(it.input || '');
          const userEmoji = getMoodEmoji(userMood);
          appendMessage('you', it.input || '', userEmoji);
          appendMessage('assistant', it.result || generateSoulResponse(it.input || ''));
        } else {
          displayResult(it);
        }
      });

      historyEl.appendChild(item);
    }
  }

  clearHistoryBtn.addEventListener('click', () => {
    if (!confirm('Xóa toàn bộ lịch sử phân tích? Hành động này không thể hoàn tác.')) return;
    saveHistoryArray([]);
    renderHistory();
    clearLastResultUI();
    showToast('Lịch sử đã được xóa');
  });

  /* ========== Initialization ========== */
  function init() {
    setChatStatus('Ready');
    renderHistory();
    // If messages area empty, show a friendly prompt
    if (messagesEl.children.length === 0) {
      appendMessage('assistant', 'Chào bạn! Mình là SoulLens (demo). Gõ vài dòng để mình lắng nghe nhé — mình sẽ trả lời bằng những lời thân thiện, như một người bạn đồng hành.');
    }
  }

  init();

  // Expose a few helpers to global for debug if needed
  window.soullens = {
    generateSoulResponse,
    analyzeImageData,
    computeRMS,
    computeZCR,
    loadHistoryArray,
    saveHistoryArray
  };

})();