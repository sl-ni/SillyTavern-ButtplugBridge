// Buttplug Bridge - SillyTavern Extension
// 監聽角色(char)訊息，比對關鍵字後透過 WebSocket 直接控制 Intiface Central 連接的玩具震動。
// 注意：此擴充套件若被安裝在 public/scripts/extensions/third-party/<repo>/ 底下（透過 GitHub 網址安裝），
// 相對路徑要比官方文件範例多一層 "../"。下面的 import 路徑已經是針對 third-party 安裝調整過的。

import { eventSource, event_types, saveSettingsDebounced } from "../../../../script.js";
import { extension_settings, getContext, renderExtensionTemplateAsync } from "../../../extensions.js";

const MODULE_NAME = "buttplug_bridge";

const defaultSettings = {
    enabled: true,
    intifaceUrl: "ws://127.0.0.1:12345",
    deviceIndex: null, // null = 自動選第一個裝置
    // 規則清單越上面優先度越高：比對時由上往下找，命中第一條符合的規則就觸發，不會再往下比對。
    rules: [
        { keywords: "劇烈震動,強烈震動", level: 0.8, duration: 4.0 },
        { keywords: "觸發震動,輕微震動,震動", level: 0.4, duration: 3.0 },
    ],
};

let ws = null;
let msgId = 1;
let connected = false;
let stopTimer = null;
let pingInterval = null;
let deviceVibrateIndices = [0]; // 該裝置有哪些震動馬達的 Index，預設只有一顆

function extractVibrateIndices(device) {
    try {
        const scalarCmds = device?.DeviceMessages?.ScalarCmd;
        if (Array.isArray(scalarCmds) && scalarCmds.length > 0) {
            const indices = [];
            scalarCmds.forEach((feature, idx) => {
                // 沒標示 ActuatorType 或標示為 Vibrate 的都算震動馬達
                if (!feature.ActuatorType || feature.ActuatorType === "Vibrate") {
                    indices.push(idx);
                }
            });
            if (indices.length > 0) return indices;
        }
    } catch (e) {
        console.warn("[Buttplug Bridge] 無法解析裝置馬達數量，預設只用 Index 0：", e);
    }
    return [0];
}

function settings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const s = extension_settings[MODULE_NAME];

    // 舊版設定（weakKeywords/strongKeywords）自動轉換成新版 rules 格式
    if (!s.rules && (s.weakKeywords || s.strongKeywords)) {
        s.rules = [];
        if (s.strongKeywords) {
            s.rules.push({
                keywords: s.strongKeywords.join(","),
                level: s.strongLevel ?? 0.8,
                duration: s.strongDuration ?? 4.0,
            });
        }
        if (s.weakKeywords) {
            s.rules.push({
                keywords: s.weakKeywords.join(","),
                level: s.weakLevel ?? 0.4,
                duration: s.weakDuration ?? 3.0,
            });
        }
        delete s.weakKeywords;
        delete s.weakLevel;
        delete s.weakDuration;
        delete s.strongKeywords;
        delete s.strongLevel;
        delete s.strongDuration;
    }

    // 補齊缺欄位（版本升級用）
    for (const key of Object.keys(defaultSettings)) {
        if (s[key] === undefined) {
            s[key] = structuredClone(defaultSettings[key]);
        }
    }
    return s;
}

function nextId() {
    return msgId++;
}

function setStatus(text) {
    const el = document.getElementById("bpb_status");
    if (el) el.textContent = text;
}

function connect() {
    const s = settings();
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        return;
    }
    try {
        ws = new WebSocket(s.intifaceUrl);
    } catch (e) {
        console.error("[Buttplug Bridge] WebSocket 建立失敗：", e);
        setStatus("連線失敗");
        return;
    }

    ws.onopen = () => {
        console.log("[Buttplug Bridge] WebSocket 已開啟，發送 RequestServerInfo");
        send([{
            RequestServerInfo: {
                Id: nextId(),
                ClientName: "SillyTavern-Buttplug-Bridge",
                MessageVersion: 3,
            },
        }]);
    };

    ws.onmessage = (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }
        for (const msg of data) {
            if (msg.ServerInfo) {
                connected = true;
                setStatus("已連線，正在取得裝置列表...");
                send([{ RequestDeviceList: { Id: nextId() } }]);

                // Buttplug 協定要求客戶端定期送 Ping，否則伺服器會判定連線失效並主動斷開
                const maxPingTime = msg.ServerInfo.MaxPingTime || 0;
                if (pingInterval) clearInterval(pingInterval);
                if (maxPingTime > 0) {
                    const interval = Math.max(500, Math.floor(maxPingTime / 2));
                    pingInterval = setInterval(() => {
                        send([{ Ping: { Id: nextId() } }]);
                    }, interval);
                }
            } else if (msg.DeviceList) {
                const devices = msg.DeviceList.Devices || [];
                if (devices.length > 0) {
                    const s2 = settings();
                    if (s2.deviceIndex === null || !devices.find(d => d.DeviceIndex === s2.deviceIndex)) {
                        s2.deviceIndex = devices[0].DeviceIndex;
                        saveSettingsDebounced();
                    }
                    const activeDevice = devices.find(d => d.DeviceIndex === s2.deviceIndex) || devices[0];
                    deviceVibrateIndices = extractVibrateIndices(activeDevice);
                    setStatus(`已連線：${devices[0].DeviceName}`);
                } else {
                    setStatus("已連線，但沒有偵測到裝置");
                }
            } else if (msg.DeviceAdded) {
                const s2 = settings();
                if (s2.deviceIndex === null) {
                    s2.deviceIndex = msg.DeviceAdded.DeviceIndex;
                    saveSettingsDebounced();
                }
                deviceVibrateIndices = extractVibrateIndices(msg.DeviceAdded);
                setStatus(`已連線：${msg.DeviceAdded.DeviceName}`);
            } else if (msg.Error) {
                console.error("[Buttplug Bridge] 伺服器回報錯誤：", msg.Error.ErrorMessage);
            }
        }
    };

    ws.onerror = (e) => {
        console.error("[Buttplug Bridge] WebSocket 錯誤：", e);
        setStatus("連線錯誤");
    };

    ws.onclose = () => {
        connected = false;
        setStatus("未連線");
        ws = null;
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
    };
}

function disconnect() {
    if (ws) {
        ws.close();
        ws = null;
    }
    connected = false;
    setStatus("未連線");
    if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
    }
}

function send(messageArray) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(messageArray));
}

function vibrate(level, durationSeconds) {
    const s = settings();
    if (!connected || s.deviceIndex === null) {
        console.warn("[Buttplug Bridge] 尚未連線或找不到裝置，無法震動");
        return;
    }

    console.log(`[Buttplug Bridge] 🔥 觸發震動 -> 強度：${level}，持續：${durationSeconds}秒，馬達：${deviceVibrateIndices.join(",")}`);
    send([{
        ScalarCmd: {
            Id: nextId(),
            DeviceIndex: s.deviceIndex,
            Scalars: deviceVibrateIndices.map(idx => ({ Index: idx, Scalar: level, ActuatorType: "Vibrate" })),
        },
    }]);

    if (stopTimer) clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
        send([{ StopDeviceCmd: { Id: nextId(), DeviceIndex: s.deviceIndex } }]);
    }, durationSeconds * 1000);
}

function handleCharacterMessage(messageIndex) {
    const s = settings();
    if (!s.enabled) return;

    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return;

    // 有些事件傳入的是索引，有些版本可能直接給訊息物件；兩種都相容處理
    const message = typeof messageIndex === "number" ? chat[messageIndex] : chat[chat.length - 1];
    if (!message) return;

    // 只處理角色(char)訊息，忽略使用者(user)自己打的訊息
    if (message.is_user) return;

    const text = message.mes || "";

    for (const rule of s.rules) {
        const keywords = (rule.keywords || "").split(",").map(k => k.trim()).filter(Boolean);
        if (keywords.some(k => text.includes(k))) {
            vibrate(rule.level, rule.duration);
            break; // 命中第一條符合的規則就停止，不再往下比對
        }
    }
}

async function loadSettingsPanel() {
    try {
        const html = await renderExtensionTemplateAsync(
            getExtensionFolder(),
            "settings",
        );
        $("#extensions_settings2").append(html);
    } catch (e) {
        console.warn("[Buttplug Bridge] 設定面板載入失敗（不影響核心功能）：", e);
        return;
    }

    const s = settings();
    $("#bpb_enabled").prop("checked", s.enabled).on("change", function () {
        s.enabled = $(this).is(":checked");
        saveSettingsDebounced();
    });
    $("#bpb_url").val(s.intifaceUrl).on("change", function () {
        s.intifaceUrl = $(this).val();
        saveSettingsDebounced();
    });
    $("#bpb_connect").on("click", () => connect());
    $("#bpb_disconnect").on("click", () => disconnect());
    $("#bpb_test").on("click", () => {
        const first = s.rules[0];
        if (first) vibrate(first.level, 3.0);
    });
    $("#bpb_add_rule").on("click", () => {
        s.rules.push({ keywords: "", level: 0.5, duration: 3.0 });
        saveSettingsDebounced();
        renderRules();
    });

    renderRules();
}

function renderRules() {
    const s = settings();
    const $container = $("#bpb_rules");
    if ($container.length === 0) return;
    $container.empty();

    s.rules.forEach((rule, index) => {
        const $row = $(`
            <div class="bpb_rule_row flex-container flexGap5" style="margin-bottom:6px; align-items:center;">
                <input type="text" class="text_pole bpb_rule_keywords" placeholder="關鍵字，用逗號分隔，例如：震動,輕微震動" style="flex:2;" />
                <input type="number" class="text_pole bpb_rule_level" placeholder="強度 0~100" min="0" max="100" step="5" style="flex:0 0 70px;" />
                <input type="number" class="text_pole bpb_rule_duration" placeholder="秒數" min="0" step="0.5" style="flex:0 0 60px;" />
                <div class="menu_button bpb_rule_up" title="提高優先度"><i class="fa-solid fa-arrow-up"></i></div>
                <div class="menu_button bpb_rule_down" title="降低優先度"><i class="fa-solid fa-arrow-down"></i></div>
                <div class="menu_button bpb_rule_del" title="刪除"><i class="fa-solid fa-trash"></i></div>
            </div>
        `);

        $row.find(".bpb_rule_keywords").val(rule.keywords).on("change", function () {
            rule.keywords = $(this).val();
            saveSettingsDebounced();
        });
        $row.find(".bpb_rule_level").val(Math.round(rule.level * 100)).on("change", function () {
            const pct = Math.max(0, Math.min(100, parseFloat($(this).val()) || 0));
            rule.level = pct / 100;
            saveSettingsDebounced();
        });
        $row.find(".bpb_rule_duration").val(rule.duration).on("change", function () {
            rule.duration = Math.max(0, parseFloat($(this).val()) || 0);
            saveSettingsDebounced();
        });
        $row.find(".bpb_rule_up").on("click", () => {
            if (index === 0) return;
            [s.rules[index - 1], s.rules[index]] = [s.rules[index], s.rules[index - 1]];
            saveSettingsDebounced();
            renderRules();
        });
        $row.find(".bpb_rule_down").on("click", () => {
            if (index === s.rules.length - 1) return;
            [s.rules[index + 1], s.rules[index]] = [s.rules[index], s.rules[index + 1]];
            saveSettingsDebounced();
            renderRules();
        });
        $row.find(".bpb_rule_del").on("click", () => {
            s.rules.splice(index, 1);
            saveSettingsDebounced();
            renderRules();
        });

        $container.append($row);
    });
}

function getExtensionFolder() {
    // 從 import.meta.url 自動反推出目前這支擴充套件被安裝在哪個資料夾底下，
    // 例如 .../scripts/extensions/third-party/ST-test/index.js -> "third-party/ST-test"
    // 這樣不管 GitHub repo 取什麼名字都能正確載入 settings.html
    try {
        const url = new URL(import.meta.url);
        const parts = url.pathname.split("/").filter(Boolean);
        const idx = parts.indexOf("extensions");
        if (idx === -1) throw new Error("找不到 extensions 路徑片段");
        return parts.slice(idx + 1, parts.length - 1).join("/");
    } catch (e) {
        console.warn("[Buttplug Bridge] 無法自動偵測資料夾名稱：", e);
        return "third-party/ST-test";
    }
}

jQuery(async () => {
    settings();
    eventSource.on(event_types.MESSAGE_RECEIVED, handleCharacterMessage);
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, handleCharacterMessage);
    await loadSettingsPanel();
    if (settings().enabled) {
        connect();
    }
});