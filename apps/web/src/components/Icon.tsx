import type { ReactNode } from "react";
export function Icon({
  name,
  size = 18,
}: {
  name:
    "play" | "pause" | "back" | "next" | "first" | "last" | "arrow" | "code" | "layers" | "check" | "alert";
  size?: number;
}) {
  const paths: Record<typeof name, ReactNode> = {
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    back: <path d="m15 5-7 7 7 7" />,
    next: <path d="m9 5 7 7-7 7" />,
    first: <path d="M5 5v14m13-14-8 7 8 7" />,
    last: <path d="M19 5v14M6 5l8 7-8 7" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    code: <path d="m7 7-5 5 5 5m10-10 5 5-5 5m-4-14-2 18" />,
    layers: <path d="m12 3 10 5-10 5L2 8Zm-9 10 9 5 9-5m-18 5 9 5 9-5" />,
    check: <path d="m4 12 5 5L20 6" />,
    alert: <path d="m12 3 10 18H2Zm0 6v5m0 3v.1" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
