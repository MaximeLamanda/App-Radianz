"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

export type TabsVariant = "default" | "line"

interface TabsContextValue {
  value: string
  onValueChange: (value: string) => void
  variant: TabsVariant
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined)

interface TabsProps {
  defaultValue?: string
  value?: string
  onValueChange?: (value: string) => void
  children: React.ReactNode
  className?: string
  /** `line` : onglets soulignés (bord bas), sans fond type « pilule ». */
  variant?: TabsVariant
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  (
    { defaultValue = "", value: controlledValue, onValueChange, children, className, variant = "default" },
    ref
  ) => {
    const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue)
    const isControlled = controlledValue !== undefined
    const value = isControlled ? controlledValue : uncontrolledValue

    const handleValueChange = React.useCallback(
      (newValue: string) => {
        if (!isControlled) {
          setUncontrolledValue(newValue)
        }
        onValueChange?.(newValue)
      },
      [isControlled, onValueChange]
    )

    return (
      <TabsContext.Provider value={{ value, onValueChange: handleValueChange, variant }}>
        <div ref={ref} className={className}>
          {children}
        </div>
      </TabsContext.Provider>
    )
  }
)
Tabs.displayName = "Tabs"

const SCROLL_EDGE_EPS = 3

function useTabsListLineScrollFades(scrollRef: React.MutableRefObject<HTMLDivElement | null>) {
  const [leftFade, setLeftFade] = React.useState(false)
  const [rightFade, setRightFade] = React.useState(false)

  const update = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { scrollLeft, scrollWidth, clientWidth } = el
    const overflow = scrollWidth > clientWidth + SCROLL_EDGE_EPS
    setLeftFade(overflow && scrollLeft > SCROLL_EDGE_EPS)
    setRightFade(overflow && scrollLeft < scrollWidth - clientWidth - SCROLL_EDGE_EPS)
  }, [scrollRef])

  React.useLayoutEffect(() => {
    update()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => update())
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollRef, update])

  return { leftFade, rightFade, update }
}

const TabsList = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const context = React.useContext(TabsContext)
  const variant = context?.variant ?? "default"
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const { leftFade, rightFade, update } = useTabsListLineScrollFades(scrollRef)

  const setScrollRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ;(ref as React.MutableRefObject<HTMLDivElement | null>).current = node
      }
    },
    [ref]
  )

  if (variant === "line") {
    return (
      <div
        className={cn(
          "relative w-full min-w-0 rounded-none border-0 border-b border-border bg-transparent",
          className
        )}
      >
        {leftFade ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-linear-to-r from-card to-transparent"
          />
        ) : null}
        {rightFade ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-linear-to-l from-card to-transparent"
          />
        ) : null}
        <div
          ref={setScrollRef}
          onScroll={update}
          className={cn(
            "inline-flex h-auto w-full min-w-0 flex-nowrap items-end justify-start gap-0 overflow-x-auto overflow-y-hidden bg-transparent p-0 text-muted-foreground",
            "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          )}
          {...props}
        >
          {children}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
})
TabsList.displayName = "TabsList"

interface TabsTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, ...props }, ref) => {
    const context = React.useContext(TabsContext)
    if (!context) {
      throw new Error("TabsTrigger must be used within Tabs")
    }

    const isActive = context.value === value
    const line = context.variant === "line"

    return (
      <button
        ref={ref}
        type="button"
        data-state={isActive ? "active" : "inactive"}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap text-sm font-medium ring-offset-background transition-all focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          line
            ? "shrink-0 rounded-none border-b-2 border-transparent bg-transparent px-2.5 py-2.5 shadow-none hover:text-foreground data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            : cn(
                "rounded-full px-3.5 py-1.5 text-xs font-medium",
                isActive
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-card/60"
              ),
          className
        )}
        onClick={() => context.onValueChange(value)}
        {...props}
      />
    )
  }
)
TabsTrigger.displayName = "TabsTrigger"

interface TabsContentProps extends React.HTMLAttributes<HTMLDivElement> {
  value: string
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, ...props }, ref) => {
    const context = React.useContext(TabsContext)
    if (!context) {
      throw new Error("TabsContent must be used within Tabs")
    }

    if (context.value !== value) {
      return null
    }

    return (
      <div
        ref={ref}
        className={cn(
          "mt-2 ring-offset-background focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          className
        )}
        {...props}
      />
    )
  }
)
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
