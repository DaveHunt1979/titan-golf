// Raw SVG strings for the 6 home screen tiles.
// Colors are injected at render time — replace #c29d4b and #264f64 with the
// theme gold so the icons always match the society accent.

export const PLAY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><style>.st0{fill:none;stroke:COLOR;stroke-miterlimit:10;stroke-width:2.83px;}</style></defs>
  <path class="st0" d="M30.62,58.1c-12.23,1.89-21.29,8.76-21.29,16.94,0,9.64,12.58,17.46,28.09,17.46,6.83,0,13.1-1.52,17.97-4.04,3.01-1.56,6.45-2.08,9.82-1.62,1.62.22,3.32.34,5.07.34,11.83,0,21.43-5.44,21.43-12.14s-9.59-12.14-21.43-12.14c-1.75,0-3.44.12-5.07.34-3.36.46-6.8-.06-9.82-1.62-3.73-1.93-8.28-3.28-13.28-3.8"/>
  <path class="st0" d="M43.01,71.77c1.08.87,1.72,1.97,1.72,3.16,0,2.85-3.66,5.16-8.17,5.16s-8.17-2.31-8.17-5.16c0-1.39.87-2.64,2.28-3.57"/>
  <line class="st0" x1="36.69" y1="72.45" x2="36.69" y2="9.74"/>
  <polyline class="st0" points="36.69 13.07 51.01 13.07 51.01 29.26 36.69 29.26"/>
  <polyline class="st0" points="51.01 17.11 63.19 17.11 63.19 34.7 43.2 34.7 43.2 29.26"/>
</svg>`;

export const EVENT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><style>.st0{fill:none;stroke:COLOR;stroke-linecap:round;stroke-linejoin:round;stroke-width:2.83px;}</style></defs>
  <circle class="st0" cx="49.04" cy="38.23" r="9.79"/>
  <line class="st0" x1="44.53" y1="39.02" x2="44.62" y2="39.02"/>
  <line class="st0" x1="49" y1="39.02" x2="49.08" y2="39.02"/>
  <line class="st0" x1="53.46" y1="39.02" x2="53.55" y2="39.02"/>
  <line class="st0" x1="46.72" y1="42.73" x2="46.81" y2="42.73"/>
  <line class="st0" x1="51.18" y1="42.73" x2="51.27" y2="42.73"/>
  <path class="st0" d="M66.67,20.21v22.78c0,8.17-6.62,14.79-14.79,14.79h-5.89c-8.17,0-14.79-6.62-14.79-14.79v-22.78"/>
  <rect class="st0" x="28.36" y="14.17" width="41.15" height="6.04" rx="1.87" ry="1.87"/>
  <path class="st0" d="M31.2,25.37s-6.68-3.5-10.53.7-.11,25.25,13.95,26.37"/>
  <path class="st0" d="M66.87,25.37s6.68-3.5,10.53.7c3.85,4.2.11,25.25-13.95,26.37"/>
  <rect class="st0" x="42.22" y="57.77" width="14.01" height="6.13" rx="1.89" ry="1.89"/>
  <line class="st0" x1="53.07" y1="80.01" x2="53.07" y2="63.9"/>
  <line class="st0" x1="45.28" y1="63.9" x2="45.28" y2="80.01"/>
  <rect class="st0" x="38.36" y="80.71" width="21.36" height="5.95" rx="1.84" ry="1.84"/>
</svg>`;

export const CLUBHOUSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><style>.st0{fill:none;stroke:COLOR;stroke-linecap:round;stroke-linejoin:round;stroke-width:2.83px;}</style></defs>
  <path class="st0" d="M21.09,68.27l-3.62,7.51h6.52v-8.78h-.89c-.86,0-1.64.49-2.01,1.26Z"/>
  <line class="st0" x1="23.99" y1="75.78" x2="30.97" y2="83.3"/>
  <path class="st0" d="M40.48,68.27l3.62,7.51h-6.52v-8.78h.89c.86,0,1.64.49,2.01,1.26Z"/>
  <line class="st0" x1="37.49" y1="75.78" x2="30.97" y2="83.3"/>
  <path class="st0" d="M19.44,70.97c-1.88,1.49-8.86,3.18-10.95,4.27-2.08,1.09-2.58,3.57-3.07,7.33-.5,3.77-.69,7.38-.69,7.38h52.11s-.2-3.62-.69-7.38c-.5-3.77-.99-6.24-3.07-7.33-2.08-1.09-9.07-2.78-10.95-4.27"/>
  <path class="st0" d="M41.68,46.86v4.16s1.69-.41,1.62,1.93c0,0,.07,2.56-2.81,3.36,0,0-.2,3.27-.5,4.36-.3,1.09-4.26,6.34-9.21,6.34h0c-4.95,0-8.92-5.25-9.21-6.34-.3-1.09-.5-4.36-.5-4.36-2.88-.79-2.81-3.36-2.81-3.36-.07-2.34,1.62-1.93,1.62-1.93v-4.09"/>
  <path class="st0" d="M42.06,46.13v-.4c0-6.22-5.05-11.27-11.27-11.27h0c-6.22,0-11.27,5.05-11.27,11.27v.4h22.54Z"/>
  <path class="st0" d="M60.65,44.94l-3.62,7.51h6.52v-8.78h-.89c-.86,0-1.64.49-2.01,1.26Z"/>
  <line class="st0" x1="63.55" y1="52.45" x2="70.52" y2="59.97"/>
  <path class="st0" d="M80.03,44.94l3.62,7.51h-6.52v-8.78h.89c.86,0,1.64.49,2.01,1.26Z"/>
  <line class="st0" x1="77.05" y1="52.45" x2="70.52" y2="59.97"/>
  <path class="st0" d="M59,47.63c-1.88,1.49-8.86,3.18-10.95,4.27-2.08,1.09-2.58,3.57-3.07,7.33-.5,3.77-.69,7.38-.69,7.38h52.11s-.2-3.62-.69-7.38c-.5-3.77-.99-6.24-3.07-7.33-2.08-1.09-9.07-2.78-10.95-4.27"/>
  <path class="st0" d="M81.24,23.52v4.16s1.69-.41,1.62,1.93c0,0,.07,2.56-2.81,3.36,0,0-.2,3.27-.5,4.36-.3,1.09-4.26,6.34-9.21,6.34h0c-4.95,0-8.92-5.25-9.21-6.34-.3-1.09-.5-4.36-.5-4.36-2.88-.79-2.81-3.36-2.81-3.36-.07-2.34,1.62-1.93,1.62-1.93v-4.09"/>
  <path class="st0" d="M81.61,22.8v-.4c0-6.22-5.05-11.27-11.27-11.27h0c-6.22,0-11.27,5.05-11.27,11.27v.4h22.54Z"/>
</svg>`;

export const CADDIE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><style>
    .st0{fill:none;stroke:COLOR;stroke-linecap:round;stroke-linejoin:round;stroke-width:2.83px;}
    .st1{fill:COLOR;stroke:COLOR;stroke-miterlimit:10;stroke-width:2.83px;}
  </style></defs>
  <path class="st0" d="M74.08,36.22c0,16.59-24.25,41.59-24.25,41.59,0,0-24.25-25-24.25-41.59,0-13.39,10.86-24.25,24.25-24.25s24.25,10.86,24.25,24.25Z"/>
  <polyline class="st0" points="66.96 65.03 70.2 65.03 81.25 86.93 18.59 86.93 29.64 65.03 33.52 65.03"/>
  <circle class="st0" cx="49.67" cy="35.15" r="13.83" transform="translate(-.6 .86) rotate(-.99)"/>
  <circle class="st1" cx="53.13" cy="42.83" r="1.62"/>
  <circle class="st1" cx="46.49" cy="42.83" r="1.62"/>
  <circle class="st1" cx="42.68" cy="36.04" r="1.62"/>
  <circle class="st1" cx="49.67" cy="36.04" r="1.62"/>
  <circle class="st1" cx="56.65" cy="36.04" r="1.62"/>
</svg>`;

export const PRACTICE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><style>
    .st0{fill:none;stroke:COLOR;stroke-linecap:round;stroke-linejoin:round;stroke-width:2.13px;}
    .st1{fill:none;stroke:COLOR;stroke-miterlimit:10;stroke-width:1.42px;}
  </style></defs>
  <path class="st0" d="M26.53,39.98l3.81,16.73c.47,2.06,2.56,3.3,4.59,2.72h0c1.9-.54,3.03-2.48,2.58-4.4l-5.29-22.2c-.49-1.9-1.8-3.57-3.72-4.46h0c-3.4-1.57-7.43-.09-9.01,3.31l-7.26,15.71c-1.62,3.51-1.62,7.55,0,11.05l5.28,11.39c.49,1.06.75,2.21.75,3.38v14.75c0,2.17,1.76,3.93,3.93,3.93h0c2.17,0,3.93-1.76,3.93-3.93v-15.25c0-.84-.13-1.67-.39-2.47l-3.02-9.36c-.47-1.45-.37-3.03.27-4.42l4.63-10.01"/>
  <path class="st0" d="M31.51,24.86h0c-3.49-1.4-5.2-5.36-3.8-8.86h0c1.4-3.49,5.36-5.2,8.86-3.8h0c3.49,1.4,5.2,5.36,3.8,8.86h0c-1.4,3.49-5.36-5.2-8.86,3.8Z"/>
  <line class="st0" x1="35.7" y1="59.11" x2="48.38" y2="86.12"/>
  <path class="st0" d="M48.38,86.12h9.9c.89,0,1.61.72,1.61,1.61v.14c0,2.62-2.13,4.75-4.75,4.75h-2.01c-2.62,0-4.75-2.13-4.75-4.75v-1.75h0Z"/>
  <circle class="st0" cx="68.04" cy="86.61" r="3.8" transform="translate(-24.85 145.79) rotate(-84.35)"/>
  <line class="st0" x1="68.04" y1="90.41" x2="68.04" y2="94"/>
  <polyline class="st1" points="74.8 21.63 84.03 16.73 79.2 25.65"/>
  <circle class="st1" cx="76.01" cy="24.75" r="3.34"/>
  <circle class="st1" cx="76.01" cy="24.75" r="13.74" transform="translate(-.19 .58) rotate(-.43)"/>
  <polyline class="st1" points="72.89 23.54 67.99 32.77 76.91 27.94"/>
  <circle class="st1" cx="76.01" cy="9.26" r="1.75" transform="translate(59.31 83.98) rotate(-84.35)"/>
  <line class="st1" x1="76.01" y1="11" x2="76.01" y2="14.43"/>
  <line class="st1" x1="76.01" y1="38.36" x2="76.01" y2="34.93"/>
  <line class="st1" x1="89.69" y1="24.68" x2="86.26" y2="24.68"/>
  <line class="st1" x1="62.33" y1="24.68" x2="65.76" y2="24.68"/>
</svg>`;

export const LOCKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs><style>.st0{fill:none;stroke:COLOR;stroke-linecap:round;stroke-linejoin:round;stroke-width:2.83px;}</style></defs>
  <path class="st0" d="M56.99,36.3v-10.58c0-.89.72-1.62,1.62-1.62,1.14,0,2.68,0,3.87,0,1.03,0,1.86.83,1.86,1.85h0c0,1.24-1.19,2.13-2.38,1.78l-4.64-1.38"/>
  <path class="st0" d="M52.52,35.8v-14.54c0-.89-.72-1.62-1.62-1.62-1.14,0-2.68,0-3.87,0-1.03,0-1.86.83-1.86,1.85h0c0,1.24,1.19,2.13,2.38,1.78l4.64-1.38"/>
  <line class="st0" x1="46.26" y1="66.78" x2="63.08" y2="66.78"/>
  <path class="st0" d="M61.03,73.03c1.13,0,2.04-.91,2.04-2.04v-32.65c0-1.13-.91-2.04-2.04-2.04h-12.74c-1.13,0-2.04.91-2.04,2.04v32.65c0,1.13.91,2.04,2.04,2.04"/>
  <line class="st0" x1="46.26" y1="42.18" x2="63.08" y2="42.18"/>
  <circle class="st0" cx="33.85" cy="77.29" r="8.86" transform="translate(-1.67 .75) rotate(-1.24)"/>
  <circle class="st0" cx="70.6" cy="79.11" r="7.04" transform="translate(-2.06 1.88) rotate(-1.51)"/>
  <line class="st0" x1="42.08" y1="80.61" x2="63.71" y2="80.61"/>
  <line class="st0" x1="42.08" y1="73.03" x2="67.04" y2="73.03"/>
  <polyline class="st0" points="33.85 68.43 33.85 33.29 22.64 29.46"/>
</svg>`;

export function tintSvg(svg: string, color: string): string {
  return svg.replace(/COLOR/g, color);
}
