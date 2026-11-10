# 資料格式（data/stations.json）

- `meta.isDemo`：false 表示真實資料版（不顯示示範橫幅）。
- `meta.startTime` / `meta.startDate`：出發時間與日期，用來推算「預估抵達」並顯示日期（例：11/15 00:30）。
- `meta.paceOptions` / `meta.defaultPace`：可選的平均速度（km/h，含休息）。
- `meta.timeLimitHours`：合格時間（小時）。
- `meta.closeWarningMinutes`：關門提醒門檻（分鐘）。
- `stations`：由北到南排序。
  - `id`、`name`、`km`（官方大約累計里程）、`close`（關門時間 `HH:MM`，跨日寫成超過 24，如 `24:30` = 隔日 00:30）
  - `region`、`place`、`road`（公路樁號）、`supplies`、`note`
  - `eta`（選填）：寫了就用固定值，不寫就依所選速度推算
  - `conflict`（選填）：來源不一致時為 true，卡片會用橘色框提示
  - `unverified`（選填）：未查證項目清單
- 路線點（v3）額外欄位：`no`（序號）、`short`（島上顯示的短名）、`tags`（checkpoint / store / meal / backup / other，可多個）、`userSeg`（與上一點距離，使用者規劃值）、`cp`（官方站號）、`brand`、`addr`、`lat`/`lng`、`hours`、`amenities`、`src`（地址／座標來源）、`gmap`、`nav`（Google 地圖搜尋與導航連結）。
  - 只有官方檢查站有 `close`；其他點不會出現關門提醒。
- `rest`（建議休息分鐘，建議值非官方）、`restMax`（備援點需要時的上限）、`restNote`（休息用途）。預估抵達＝出發＋里程÷騎乘均速＋前面各點 `rest` 合計；`meta.paceMode` 為 moving（騎乘均速，不含休息）。
- `sources`：資料來源（`label`、`url`、`kind`），只接受 https 連結。

資料擷取日：2026-11-10。來源：中華民國自行車協會 https://taiwanbike.org/index.php/688
