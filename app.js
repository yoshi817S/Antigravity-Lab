/**
 * 昭和宇宙管制室風 HomeAI ダッシュボード
 * 控制ロジック & 低負荷アニメーション (改善版)
 */

(function () {
  'use strict';

  // ---------------------------------------------------------
  // 1. 定数と状態管理
  // ---------------------------------------------------------
  const STATE = {
    radarActive: true,
    emergencyActive: false,
    logFeedActive: true,
    themeAmber: false,
    // アニメーション軽減設定 (OS設定)
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    startTime: Date.now(),
    temp: 24.2,
    humidity: 52.0,
    aiLoad: 12
  };

  const colors = {
    get primary() {
      return STATE.themeAmber ? '#ffb000' : '#00ff66';
    },
    get primaryDim() {
      return STATE.themeAmber ? 'rgba(255, 176, 0, 0.2)' : 'rgba(0, 255, 102, 0.2)';
    },
    emergency: '#ff3333'
  };

  // ---------------------------------------------------------
  // 2. DOM要素の取得
  // ---------------------------------------------------------
  const viewport = document.getElementById('console-viewport');
  const clockEl = document.getElementById('clock-time');
  const uptimeEl = document.getElementById('uptime-counter');
  const dateEl = document.getElementById('system-date');
  const logContentEl = document.getElementById('system-log-content');
  
  // スイッチ類
  const switchRadar = document.getElementById('switch-radar');
  const switchStyle = document.getElementById('switch-style');
  const switchEmergency = document.getElementById('switch-emergency');
  const switchLog = document.getElementById('switch-log');

  // インジケーターランプ類
  const lampSysActive = document.getElementById('lamp-sys-active');
  const lampCaution = document.getElementById('lamp-caution');
  const lampEmergency = document.getElementById('lamp-emergency');
  const lampLine = document.getElementById('lamp-line');

  // 新設：小パネルのステータス値要素
  const statusNetLink = document.getElementById('status-net-link');
  const statusNetSpeed = document.getElementById('status-net-speed');
  const statusAiCore = document.getElementById('status-ai-core');
  const statusAiLoad = document.getElementById('status-ai-load');
  const statusEnvSec = document.getElementById('status-env-sec');
  const statusEnvAir = document.getElementById('status-env-air');

  // Canvas
  const canvasOsc = document.getElementById('canvas-oscilloscope');
  const canvasRadar = document.getElementById('canvas-radar');
  let ctxOsc = null;
  let ctxRadar = null;

  // ---------------------------------------------------------
  // 3. アスペクト比スケーリング (16:9を常に維持)
  // ---------------------------------------------------------
  function resizeViewport() {
    const baseWidth = 1920;
    const baseHeight = 1080;
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;

    const scale = Math.min(windowWidth / baseWidth, windowHeight / baseHeight);
    viewport.style.transform = `scale(${scale})`;
    viewport.style.transformOrigin = 'center center';
  }

  // ---------------------------------------------------------
  // 4. クロック & カウンターの更新 (1秒周期)
  // ---------------------------------------------------------
  function updateClock() {
    const now = new Date();
    
    // 時間表示 (HH:MM:SS)
    const hrs = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const secs = String(now.getSeconds()).padStart(2, '0');
    clockEl.textContent = `${hrs}:${mins}:${secs}`;

    // 改善：西暦を固定せず、実際の現在日付を表示する
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const date = String(now.getDate()).padStart(2, '0');
    dateEl.textContent = `${year}-${month}-${date}`;

    // UPTIME (起動時間) カウンターの更新
    const diffMs = Date.now() - STATE.startTime;
    const upSecs = Math.floor(diffMs / 1000) % 60;
    const upMins = Math.floor(diffMs / (1000 * 60)) % 60;
    const upHrs = Math.floor(diffMs / (1000 * 60 * 60));
    
    const displayHrs = String(upHrs).padStart(3, '0');
    const displayMins = String(upMins).padStart(2, '0');
    const displaySecs = String(upSecs).padStart(2, '0');
    uptimeEl.textContent = `${displayHrs}:${displayMins}:${displaySecs}`;
  }

  // ---------------------------------------------------------
  // 5. アナログメーター & 小パネルステータスの動的更新
  // ---------------------------------------------------------
  function updateMeters() {
    // 擬似的なゆらぎ値の生成
    if (STATE.emergencyActive) {
      STATE.temp = STATE.temp * 0.98 + 29.5 * 0.02 + (Math.random() - 0.5) * 0.1;
      STATE.humidity = STATE.humidity * 0.98 + 40.0 * 0.02 + (Math.random() - 0.5) * 0.2;
    } else {
      STATE.temp += (Math.random() - 0.5) * 0.15;
      STATE.humidity += (Math.random() - 0.5) * 0.3;
      if (STATE.temp < 21.0) STATE.temp = 21.0;
      if (STATE.temp > 26.0) STATE.temp = 26.0;
      if (STATE.humidity < 45) STATE.humidity = 45;
      if (STATE.humidity > 65) STATE.humidity = 65;
    }

    // メーター表示の更新
    document.getElementById('val-temp').textContent = STATE.temp.toFixed(1);
    document.getElementById('val-humidity').textContent = Math.round(STATE.humidity);

    // 針の回転 (CSSのtransform)
    const tempMin = 15, tempMax = 35;
    const tempPercent = (STATE.temp - tempMin) / (tempMax - tempMin);
    const tempAngle = -60 + tempPercent * 120;
    document.getElementById('needle-temp').style.transform = `rotate(${tempAngle}deg)`;

    const humiMin = 20, humiMax = 80;
    const humiPercent = (STATE.humidity - humiMin) / (humiMax - humiMin);
    const humiAngle = -60 + humiPercent * 120;
    document.getElementById('needle-humidity').style.transform = `rotate(${humiAngle}deg)`;

    // SVG円弧ゲージの dashoffset 更新
    const dashLength = 125;
    document.getElementById('bar-temp').style.strokeDashoffset = dashLength - (tempPercent * dashLength);
    document.getElementById('bar-humidity').style.strokeDashoffset = dashLength - (humiPercent * dashLength);

    // 改善：3つの小パネルデータの更新と色の連動
    updateSubPanels();
  }

  // 小パネルの状態切り替え処理
  function updateSubPanels() {
    if (STATE.emergencyActive) {
      // 1. NETWORK (警告・通信異常)
      statusNetLink.textContent = "OFFLINE";
      statusNetLink.className = "status-value val-red";
      statusNetSpeed.textContent = "0.0k bps";
      statusNetSpeed.className = "status-value val-red";

      // 2. AI STATUS (警告・暴走状態)
      statusAiCore.textContent = "ERROR";
      statusAiCore.className = "status-value val-red";
      statusAiLoad.textContent = "099%";
      statusAiLoad.className = "status-value val-red";

      // 3. HOME ENV (警告・セキュリティ侵入検出)
      statusEnvSec.textContent = "BREACH";
      statusEnvSec.className = "status-value val-red";
      statusEnvAir.textContent = "DANGER";
      statusEnvAir.className = "status-value val-red";
    } else {
      // 正常時 (10%〜18%の微変動)
      STATE.aiLoad = Math.floor(10 + Math.random() * 9);

      // 1. NETWORK (正常)
      statusNetLink.textContent = "ONLINE";
      statusNetLink.className = "status-value val-green";
      statusNetSpeed.textContent = "4.8k bps";
      statusNetSpeed.className = "status-value val-green";

      // 2. AI STATUS (正常)
      statusAiCore.textContent = "ACTIVE";
      statusAiCore.className = "status-value val-green";
      statusAiLoad.textContent = `0${STATE.aiLoad}%`;
      statusAiLoad.className = "status-value val-green";

      // 3. HOME ENV (正常または一時的な注意)
      statusEnvSec.textContent = "SECURE";
      statusEnvSec.className = "status-value val-green";
      
      // 空気質はたまに「MODERATE (注意)」にして黄色アラートを確認できるようにする
      if (Math.random() < 0.2) {
        statusEnvAir.textContent = "MODERATE";
        statusEnvAir.className = "status-value val-yellow";
      } else {
        statusEnvAir.textContent = "GOOD";
        statusEnvAir.className = "status-value val-green";
      }
    }
  }

  // ---------------------------------------------------------
  // 6. システムログ
  // ---------------------------------------------------------
  const logHistory = [];
  const maxLogLines = 8; // 小パネル追加に伴い表示領域が狭くなったため上限を調整

  const dummyMessages = [
    "SYS-78: LOGIC CIRCUIT INTEGRITY: 100%",
    "ENV-MONITOR: SENSOR GROUP A ONLINE",
    "RADAR-UNIT: NO INTRUSIONS IN SECTOR 4",
    "MEM-BANK: COMPACTING DATA SLOTS...",
    "COSMO-AI: THINKING LOOP SECURE",
    "SYS-78: POWER INLET LEVEL STABLE",
    "ENV-MONITOR: INTERNAL VENTILATION OK",
    "RADAR-UNIT: SWEEPER ROTATION CALIBRATED",
    "COSMO-AI: HOME APPLIANCE STATS RECORDED"
  ];

  const emergencyMessages = [
    "!!! SYS-WARN: CORE OVERLOAD DETECTED !!!",
    "!!! RADAR-ALERT: SEC-2 UNKNOWN OBJECT !!!",
    "!!! EMERGENCY CLAMP ENGAGED !!!",
    "!!! SAFETY CORE SHIELD OVERRIDE !!!"
  ];

  function addLog(text) {
    if (!STATE.logFeedActive) return;
    
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    const formattedText = `[${timeStr}] ${text}`;

    logHistory.push(formattedText);
    if (logHistory.length > maxLogLines) {
      logHistory.shift();
    }
    
    logContentEl.innerHTML = logHistory.join('\n');
    logContentEl.scrollTop = logContentEl.scrollHeight;
  }

  function triggerRandomLog() {
    if (!STATE.logFeedActive) return;
    let pool = STATE.emergencyActive ? emergencyMessages : dummyMessages;
    const msg = pool[Math.floor(Math.random() * pool.length)];
    addLog(msg);
  }

  // ---------------------------------------------------------
  // 7. 低負荷 Canvas アニメーション (フレームレート間引き)
  // ---------------------------------------------------------
  let lastFrameTime = 0;
  const fpsInterval = 1000 / 20; // 20 FPS制限
  let radarAngle = 0;

  const radarTargets = [
    { x: 120, y: 70, size: 4, name: "CAT", active: false, timer: 0 },
    { x: 80, y: 120, size: 3, name: "RUMBA", active: false, timer: 0 },
    { x: 190, y: 150, size: 5, name: "HUMN-1", active: false, timer: 0 }
  ];

  function initCanvases() {
    ctxOsc = canvasOsc.getContext('2d');
    ctxRadar = canvasRadar.getContext('2d');

    canvasOsc.width = 300;
    canvasOsc.height = 150;
    canvasRadar.width = 300;
    canvasRadar.height = 300;
  }

  function drawLoop(timestamp) {
    requestAnimationFrame(drawLoop);

    const elapsed = timestamp - lastFrameTime;
    if (elapsed < fpsInterval) return;
    lastFrameTime = timestamp - (elapsed % fpsInterval);

    if (STATE.reducedMotion) {
      drawStaticOscilloscope();
      drawStaticRadar();
      return;
    }

    drawOscilloscope(timestamp);
    if (STATE.radarActive) {
      drawRadar();
    }
  }

  // 改善：オシロスコープ波形に微細な変化を追加 (CPU負荷は抑えたまま)
  function drawOscilloscope(time) {
    ctxOsc.clearRect(0, 0, canvasOsc.width, canvasOsc.height);
    
    ctxOsc.strokeStyle = STATE.themeAmber ? 'rgba(255, 176, 0, 0.05)' : 'rgba(0, 255, 102, 0.05)';
    ctxOsc.lineWidth = 1;
    
    // グリッド線
    for (let x = 0; x < canvasOsc.width; x += 30) {
      ctxOsc.beginPath(); ctxOsc.moveTo(x, 0); ctxOsc.lineTo(x, canvasOsc.height); ctxOsc.stroke();
    }
    for (let y = 0; y < canvasOsc.height; y += 30) {
      ctxOsc.beginPath(); ctxOsc.moveTo(0, y); ctxOsc.lineTo(canvasOsc.width, y); ctxOsc.stroke();
    }

    ctxOsc.strokeStyle = colors.primaryDim;
    ctxOsc.beginPath();
    ctxOsc.moveTo(0, canvasOsc.height / 2);
    ctxOsc.lineTo(canvasOsc.width, canvasOsc.height / 2);
    ctxOsc.stroke();

    ctxOsc.strokeStyle = STATE.emergencyActive ? colors.emergency : colors.primary;
    ctxOsc.lineWidth = 2;
    ctxOsc.beginPath();

    const speed = time * 0.005;
    
    // 改善：波全体の振幅がゆっくり呼吸（収縮）するモジュレーション値
    const amplitudeMod = 1.0 + Math.sin(time * 0.001) * 0.25;

    for (let x = 0; x < canvasOsc.width; x++) {
      let y = canvasOsc.height / 2;
      
      if (STATE.emergencyActive) {
        // 緊急時は荒々しく細かく揺れるノイズ矩形波
        y += Math.sin(x * 0.08 + speed) * 25 * amplitudeMod;
        y += Math.sin(x * 0.25 + speed * 2) * 5; // 高周波ノイズ
        y += (Math.random() - 0.5) * 6;
      } else {
        // 改善：平常時の穏やかな合成波に、微細な高周波のうねり（変化）を追加
        y += Math.sin(x * 0.035 - speed) * 16 * amplitudeMod;
        y += Math.sin(x * 0.012 - speed * 0.4) * 8;
        y += Math.sin(x * 0.18 - speed * 1.5) * 2; // 高周波の微小な「うねり」
      }

      if (x === 0) {
        ctxOsc.moveTo(x, y);
      } else {
        ctxOsc.lineTo(x, y);
      }
    }
    ctxOsc.stroke();
  }

  function drawStaticOscilloscope() {
    ctxOsc.clearRect(0, 0, canvasOsc.width, canvasOsc.height);
    ctxOsc.strokeStyle = colors.primary;
    ctxOsc.lineWidth = 2;
    ctxOsc.beginPath();
    ctxOsc.moveTo(0, canvasOsc.height / 2);
    for (let x = 0; x < canvasOsc.width; x++) {
      let y = canvasOsc.height / 2 + Math.sin(x * 0.04) * 12;
      ctxOsc.lineTo(x, y);
    }
    ctxOsc.stroke();
  }

  function drawRadar() {
    const cx = canvasRadar.width / 2;
    const cy = canvasRadar.height / 2;
    const maxRadius = cx - 10;

    ctxRadar.fillStyle = 'rgba(4, 8, 5, 0.15)';
    ctxRadar.fillRect(0, 0, canvasRadar.width, canvasRadar.height);

    ctxRadar.strokeStyle = colors.primaryDim;
    ctxRadar.lineWidth = 1;
    ctxRadar.beginPath();
    ctxRadar.arc(cx, cy, maxRadius * 0.33, 0, Math.PI * 2);
    ctxRadar.arc(cx, cy, maxRadius * 0.66, 0, Math.PI * 2);
    ctxRadar.arc(cx, cy, maxRadius, 0, Math.PI * 2);
    ctxRadar.stroke();

    ctxRadar.beginPath();
    ctxRadar.moveTo(cx - maxRadius, cy);
    ctxRadar.lineTo(cx + maxRadius, cy);
    ctxRadar.moveTo(cx, cy - maxRadius);
    ctxRadar.lineTo(cx, cy + maxRadius);
    ctxRadar.stroke();

    radarAngle += 0.04;
    if (radarAngle >= Math.PI * 2) {
      radarAngle = 0;
    }

    const sweepX = cx + Math.cos(radarAngle) * maxRadius;
    const sweepY = cy + Math.sin(radarAngle) * maxRadius;
    ctxRadar.strokeStyle = colors.primary;
    ctxRadar.lineWidth = 2;
    ctxRadar.beginPath();
    ctxRadar.moveTo(cx, cy);
    ctxRadar.lineTo(sweepX, sweepY);
    ctxRadar.stroke();

    radarTargets.forEach(target => {
      const targetAngle = Math.atan2(target.y - cy, target.x - cx);
      let angleDiff = targetAngle - radarAngle;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

      if (Math.abs(angleDiff) < 0.08) {
        target.active = true;
        target.timer = 1.0;
      }

      if (target.active) {
        ctxRadar.fillStyle = STATE.emergencyActive ? `rgba(255, 51, 51, ${target.timer})` : `rgba(${STATE.themeAmber ? '255, 176, 0' : '0, 255, 102'}, ${target.timer})`;
        ctxRadar.beginPath();
        ctxRadar.arc(target.x, target.y, target.size, 0, Math.PI * 2);
        ctxRadar.fill();

        ctxRadar.fillStyle = STATE.emergencyActive ? `rgba(255, 51, 51, ${target.timer * 0.8})` : `rgba(${STATE.themeAmber ? '255, 176, 0' : '0, 255, 102'}, ${target.timer * 0.8})`;
        ctxRadar.font = '9px monospace';
        ctxRadar.fillText(target.name, target.x + 8, target.y + 3);

        target.timer -= 0.02;
        if (target.timer <= 0) {
          target.active = false;
        }
      }
    });
  }

  function drawStaticRadar() {
    const cx = canvasRadar.width / 2;
    const cy = canvasRadar.height / 2;
    const maxRadius = cx - 10;

    ctxRadar.clearRect(0, 0, canvasRadar.width, canvasRadar.height);
    ctxRadar.strokeStyle = colors.primaryDim;
    ctxRadar.lineWidth = 1;
    ctxRadar.beginPath();
    ctxRadar.arc(cx, cy, maxRadius * 0.5, 0, Math.PI * 2);
    ctxRadar.arc(cx, cy, maxRadius, 0, Math.PI * 2);
    ctxRadar.stroke();

    radarTargets.forEach(target => {
      ctxRadar.fillStyle = colors.primary;
      ctxRadar.beginPath();
      ctxRadar.arc(target.x, target.y, target.size, 0, Math.PI * 2);
      ctxRadar.fill();
      ctxRadar.font = '9px monospace';
      ctxRadar.fillText(target.name, target.x + 8, target.y + 3);
    });
  }

  // ---------------------------------------------------------
  // 8. インタラクションとスイッチイベント
  // ---------------------------------------------------------
  function setupEventListeners() {
    switchRadar.addEventListener('change', function () {
      STATE.radarActive = this.checked;
      if (!STATE.radarActive) {
        ctxRadar.fillStyle = '#040805';
        ctxRadar.fillRect(0, 0, canvasRadar.width, canvasRadar.height);
        addLog("RADAR-UNIT: SCANNER SHUTDOWN.");
      } else {
        addLog("RADAR-UNIT: SCANNER BOOTING...");
      }
    });

    switchStyle.addEventListener('change', function () {
      STATE.themeAmber = this.checked;
      if (STATE.themeAmber) {
        document.body.classList.add('theme-amber');
        addLog("SYS-78: DISPLAY STYLE: AMBER MONOCHROME.");
      } else {
        document.body.classList.remove('theme-amber');
        addLog("SYS-78: DISPLAY STYLE: GREEN MONOCHROME.");
      }
      updateMeters();
    });

    switchEmergency.addEventListener('change', function () {
      STATE.emergencyActive = this.checked;
      if (STATE.emergencyActive) {
        lampEmergency.classList.add('active');
        lampCaution.classList.add('active');
        lampSysActive.classList.remove('active');
        addLog("!!! SYSTEM ALERT: EMERGENCY CLAMP ENGAGED !!!");
      } else {
        lampEmergency.classList.remove('active');
        lampCaution.classList.remove('active');
        lampSysActive.classList.add('active');
        addLog("SYS-78: CONTROL LEVEL RESTORED. ALL CLEAR.");
      }
      updateMeters();
    });

    switchLog.addEventListener('change', function () {
      STATE.logFeedActive = this.checked;
    });

    window.addEventListener('resize', resizeViewport);
  }

  // ---------------------------------------------------------
  // 9. 初期化
  // ---------------------------------------------------------
  function init() {
    initCanvases();
    setupEventListeners();
    resizeViewport();

    updateClock();
    updateMeters();

    addLog("COSMO-LINK SYS-78 BOOTSTRAP...");
    setTimeout(() => addLog("SYSTEM VOLTAGE: NORMAL"), 300);
    setTimeout(() => addLog("LOGIC CIRCUITRY CALIBRATED"), 600);
    setTimeout(() => addLog("HOME AI KERNEL ACTIVE (v1.78)"), 900);

    setInterval(updateClock, 1000);
    setInterval(updateMeters, 2500);
    setInterval(triggerRandomLog, 7000);

    requestAnimationFrame(drawLoop);
  }

  window.addEventListener('DOMContentLoaded', init);

})();
