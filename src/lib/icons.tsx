import React from "react";

const ACC = "#3859E8";
const TXT3 = "#AAB5CC";
const TXT2 = "#5A6A99";
const ERR = "#D93025";
const WARN = "#C46C00";

export const Mic = ({ c = TXT3, s = 26 }: { c?: string; s?: number }) => (
  <svg width={s} height={s * 1.14} viewBox="0 0 28 32" fill="none">
    <rect x="8" y="1" width="12" height="18" rx="6" fill={c} />
    <path d="M4 16c0 5.5 4.5 10 10 10s10-4.5 10-10" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
    <line x1="14" y1="26" x2="14" y2="31" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
    <line x1="9" y1="31" x2="19" y2="31" stroke={c} strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

export const Lupa = ({ c = TXT3, s = 20 }: { c?: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
    <circle cx="8.5" cy="8.5" r="5.5" stroke={c} strokeWidth="2" />
    <line x1="12.5" y1="12.5" x2="18" y2="18" stroke={c} strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const Grid = ({ c = TXT3, s = 20 }: { c?: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 20 20" fill="none">
    <rect x="2" y="2" width="7" height="7" rx="1.5" fill={c} />
    <rect x="11" y="2" width="7" height="7" rx="1.5" fill={c} />
    <rect x="2" y="11" width="7" height="7" rx="1.5" fill={c} />
    <rect x="11" y="11" width="7" height="7" rx="1.5" fill={c} />
  </svg>
);

export const Back = ({ c = TXT2 }: { c?: string }) => (
  <svg width="10" height="16" viewBox="0 0 10 16" fill="none">
    <path d="M7 2L2 8l5 6" stroke={c} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Check = () => (
  <svg width="68" height="68" viewBox="0 0 68 68" fill="none" style={{ animation: "scalein .4s cubic-bezier(.34,1.56,.64,1) both" }}>
    <circle cx="34" cy="34" r="34" fill="#1B7C45" />
    <path d="M20 34l10 11L48 24" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="40" strokeDashoffset="40" style={{ animation: "checkdraw .5s .25s ease forwards" }} />
  </svg>
);

export const WarnIcon = ({ c = WARN }: { c?: string }) => (
  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
    <path d="M7 2.5v4.5M7 10v.5" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="7" cy="7" r="6" stroke={c} strokeWidth="1.6" fill="none" />
  </svg>
);

export { ACC, ERR };
