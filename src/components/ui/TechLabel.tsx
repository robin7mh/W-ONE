import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Small uppercase, letter-spaced technical label. */
export function TechLabel({
  children,
  className,
  as: Tag = 'span'
}: {
  children: ReactNode
  className?: string
  as?: 'span' | 'div' | 'h2' | 'h3'
}) {
  return <Tag className={cn('tech-label', className)}>{children}</Tag>
}
