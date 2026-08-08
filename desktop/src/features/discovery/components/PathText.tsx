import { Fragment } from "react";

interface PathTextProps {
  className: string;
  path: string;
}

export function PathText({ className, path }: PathTextProps) {
  const parts = path.split(/([\\/])/);

  return (
    <p className={className} title={path}>
      {parts.map((part, index) => (
        <Fragment key={`${index}-${part}`}>
          {part}
          {(part === "\\" || part === "/") && <wbr />}
        </Fragment>
      ))}
    </p>
  );
}
