/**
 * 太陽位置（FE-V3D-06；NOAA 簡化演算法，誤差約 ±0.5°）。
 * 輸入緯度／經度（度，東經為正）與 UTC 時刻；回傳羅盤方位角（0=北、90=東，順時針）與仰角（度）。
 */
export function solarPosition(
  latDeg: number,
  lonDeg: number,
  date: Date,
): { azimuthDeg: number; elevationDeg: number } {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86_400_000 + 2440587.5;
  const jc = (jd - 2451545) / 36525;
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C =
    Math.sin(M * rad) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
    Math.sin(2 * M * rad) * (0.019993 - 0.000101 * jc) +
    Math.sin(3 * M * rad) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * rad);
  const eps0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * rad);
  const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
  const y = Math.tan((eps / 2) * rad) ** 2;
  const eqTime =
    (4 *
      (y * Math.sin(2 * L0 * rad) -
        2 * e * Math.sin(M * rad) +
        4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) -
        0.5 * y * y * Math.sin(4 * L0 * rad) -
        1.25 * e * e * Math.sin(2 * M * rad))) /
    rad;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolar = (((minutes + eqTime + 4 * lonDeg) % 1440) + 1440) % 1440;
  const hourAngle = trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180;
  const lat = latDeg * rad;
  const cosZen = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle * rad);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZen)));
  const elevationDeg = 90 - zen / rad;
  const az = Math.atan2(
    Math.sin(hourAngle * rad),
    Math.cos(hourAngle * rad) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat),
  );
  const azimuthDeg = (((az / rad + 180) % 360) + 360) % 360;
  return { azimuthDeg, elevationDeg };
}

/**
 * 羅盤方位 → 場景方位（viewer presetDirection：0＝+Z、90＝+X）。
 * 平面圖上方（−Z）為北；northDeg＝平面圖「北」相對於畫面上方順時針旋轉的角度。
 */
export function compassToSceneAzimuth(compassDeg: number, northDeg = 0): number {
  const a = 180 - (compassDeg - northDeg);
  return ((((a + 180) % 360) + 360) % 360) - 180;
}
