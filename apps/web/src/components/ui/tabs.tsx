
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Tabs as TabsPrimitive } from "radix-ui"
const TabsOrientation = React.createContext<'horizontal' | 'vertical'>('horizontal')
const TabsVariant = React.createContext<'default' | 'line'>('default')

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsOrientation.Provider value={orientation}>
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
    </TabsOrientation.Provider>
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground data-[orientation=horizontal]:h-9 data-[orientation=vertical]:h-fit data-[orientation=vertical]:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const orientation = React.useContext(TabsOrientation)
  return (
    <TabsVariant.Provider value={variant ?? 'default'}>
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-orientation={orientation}
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
    </TabsVariant.Provider>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const orientation = React.useContext(TabsOrientation)
  const variant = React.useContext(TabsVariant)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-orientation={orientation}
      data-variant={variant}
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-[variant=default]:data-[state=active]:shadow-sm data-[variant=line]:data-[state=active]:shadow-none dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "data-[variant=line]:bg-transparent data-[variant=line]:data-[state=active]:bg-transparent dark:data-[variant=line]:data-[state=active]:border-transparent dark:data-[variant=line]:data-[state=active]:bg-transparent",
        "data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity data-[orientation=horizontal]:after:inset-x-0 data-[orientation=horizontal]:after:bottom-[-5px] data-[orientation=horizontal]:after:h-0.5 data-[orientation=vertical]:after:inset-y-0 data-[orientation=vertical]:after:-right-1 data-[orientation=vertical]:after:w-0.5 data-[variant=line]:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
