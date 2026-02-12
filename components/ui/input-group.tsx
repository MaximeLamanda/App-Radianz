"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const InputGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      data-slot="input-group"
      className={cn(
        "flex h-10 w-full min-w-0 items-center rounded-md border border-input bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 [&_input]:border-0 [&_input]:bg-transparent [&_input]:shadow-none [&_input]:outline-none [&_input]:ring-0 [&_input]:focus-visible:ring-0",
        className
      )}
      {...props}
    />
  )
)
InputGroup.displayName = "InputGroup"

const inputGroupAddonVariants = cva(
  "text-muted-foreground flex h-full shrink-0 cursor-default select-none items-center justify-center gap-2 px-3 text-sm font-medium [&>svg]:size-4",
  {
    variants: {
      align: {
        "inline-start": "order-first",
        "inline-end": "order-last",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  }
)

interface InputGroupAddonProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof inputGroupAddonVariants> {}

const InputGroupAddon = React.forwardRef<HTMLDivElement, InputGroupAddonProps>(
  ({ className, align = "inline-start", ...props }, ref) => (
    <div
      ref={ref}
      data-slot="input-group-addon"
      className={cn(inputGroupAddonVariants({ align }), className)}
      {...props}
    />
  )
)
InputGroupAddon.displayName = "InputGroupAddon"

interface InputGroupButtonProps extends React.ComponentProps<typeof Button> {}

const InputGroupButton = React.forwardRef<HTMLButtonElement, InputGroupButtonProps>(
  ({ className, variant = "ghost", size = "icon", ...props }, ref) => (
    <Button
      ref={ref}
      type="button"
      variant={variant}
      size={size}
      className={cn("shrink-0 rounded-md", className)}
      {...props}
    />
  )
)
InputGroupButton.displayName = "InputGroupButton"

const InputGroupInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<typeof Input>
>(({ className, ...props }, ref) => (
  <Input
    ref={ref}
    data-slot="input-group-control"
    className={cn(
      "flex-1 rounded-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
      className
    )}
    {...props}
  />
))
InputGroupInput.displayName = "InputGroupInput"

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput }
