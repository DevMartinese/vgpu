import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}

function CardHeader({ children, className = '', ...props }: CardProps) {
  return (
    <div className={`flex items-center justify-between px-4 py-2 border-b ${className}`} {...props}>
      {children}
    </div>
  );
}

function CardBody({ children, className = '', ...props }: CardProps) {
  return (
    <div className={className} {...props}>
      {children}
    </div>
  );
}

Card.Header = CardHeader;
Card.Body = CardBody;

export { Card };
