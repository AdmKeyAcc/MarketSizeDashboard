export default function TraknusLogo({ size = 40 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TRAKNUS"
      role="img"
      style={{ flexShrink: 0 }}
    >
      <rect width="40" height="40" rx="9" fill="var(--blue-700)" />
      <path d="M0 9a9 9 0 0 1 9-9h31L9 40H9a9 9 0 0 1-9-9V9Z" fill="var(--blue-600)" />
      <path d="M40 0 15 40H4L29 0h11Z" fill="var(--red-600)" />
      <path d="M40 9v11L26 40h-9L38 3a9 9 0 0 1 2 6Z" fill="var(--red-500)" />
    </svg>
  );
}
