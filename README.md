# SillyTavern Buttplug Bridge

讓角色卡(char)在回覆中提到特定關鍵字時，透過 [Intiface Central](https://intiface.com/central/) 直接觸發你連接的玩具震動。純前端擴充套件，不需要另外跑 Python 腳本或伺服器。

## 原理

- 這是 SillyTavern 的**前端擴充套件**，用 JavaScript 監聽 SillyTavern 內部的訊息事件（`MESSAGE_RECEIVED` / `CHARACTER_MESSAGE_RENDERED`）。
- 只有角色(char)的訊息會被檢查關鍵字，使用者(user)自己打的訊息會被忽略。
- 擴充套件在**你的瀏覽器**裡直接開 WebSocket 連到 Intiface Central，走原生 [Buttplug Protocol](https://buttplug-spec.docs.buttplug.io/)，不需要中間伺服器轉發。

## 安裝方式

1. 打開 SillyTavern → 左側選單 **Extensions（擴充套件）** → 上方 **Install Extension**
2. 貼上這個GitHub 網址
3. 選擇「安裝給所有使用者」或「只安裝給目前使用者」都可以
4. 安裝完成後重新整理頁面，在 Extensions 面板裡應該會看到「Buttplug Bridge」的設定區塊

## 使用方式

1. 手機打開 **Intiface Central**，確認玩具已連接
2. 進入 Intiface Central 的 **Settings → Server**，把 WebSocket Server 打開，並允許區域網路連線（不要只綁 localhost）
3. 確認手機跟跑 SillyTavern 的裝置在**同一個 Wi-Fi**
4. 在 SillyTavern 的 Buttplug Bridge 設定裡，填入手機的區網 IP，例如：
   ```
   ws://1XX.XXX.XXX
   ```
5. 按「連線」，狀態顯示已連線+裝置名稱後即完成
6. 之後角色回覆內容只要包含「震動」「輕微震動」「觸發震動」會觸發弱震動；包含「劇烈震動」「強烈震動」會觸發強震動

## 自訂關鍵字/強度



## 注意事項 / 已知限制

- 還再測試中
