// Based on shadcn/ui (https://ui.shadcn.com), MIT License, Copyright (c) 2023 shadcn.
// See THIRD_PARTY_NOTICES.md.
import * as LabelPrimitive from '@radix-ui/react-label'
import * as React from 'react'
import { cn } from '@renderer/lib/utils'

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
