import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold tracking-wide transition-colors transition-opacity focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#E4FE55]/30 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[#E4FE55] text-[#171717] hover:bg-[#d7f24f] min-w-[140px] h-11 px-5",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-border bg-transparent text-foreground hover:border-[#E4FE55]/50 hover:bg-[#E4FE55]/5 dark:border-zinc-700 dark:text-zinc-200",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:border dark:border-zinc-700",
        ghost: "hover:bg-[#E4FE55]/10 hover:text-foreground",
        link: "text-[#E4FE55] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 min-w-[140px] px-5 py-3",
        sm: "h-10 min-w-[100px] px-4",
        lg: "h-12 min-w-[160px] px-6",
        icon: "size-10 rounded-xl",
      },
    },
    compoundVariants: [
      {
        size: "icon",
        variant: "default",
        class: "bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:border dark:border-zinc-700 min-w-0",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
