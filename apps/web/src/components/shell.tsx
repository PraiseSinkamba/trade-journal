"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  BookText,
  CalendarDays,
  Import,
  LayoutDashboard,
  ListOrdered,
  NotebookPen,
  Settings,
  ListChecks,
  BookmarkPlus,
  Wallet,
  Landmark,
  Settings2,
  Mic,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LuxAlgoMark } from "@/components/luxalgo-mark";
import { PrivacyToggle } from "./privacy";
import { ThemeToggle } from "./theme";
import { PageTransition } from "./page-transition";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  SidebarInset,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { FILTER_KEYS } from "@luxalgo/journal-core";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/journal", label: "Daily journal", icon: NotebookPen },
  { href: "/trades", label: "Trades", icon: ListOrdered },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/prop-firms", label: "Prop firms", icon: Landmark },
  { href: "/notebook", label: "Notebook", icon: BookText },
  { href: "/playbooks", label: "Playbooks", icon: BookOpen },
  { href: "/progress", label: "Progress", icon: ListChecks },
  { href: "/missed", label: "Missed trades", icon: BookmarkPlus },
] as const;

const NAV_SETUP = [
  { href: "/import", label: "Import", icon: Import },
  { href: "/accounts", label: "Accounts", icon: Wallet },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/**
 * AppSidebar — SidebarProvider-rooted sidebar using shadcn sidebar primitives.
 * Layout usage:
 *   <SidebarProvider>
 *     <AppSidebar />
 *     <SidebarInset><PageTransition>{children}</PageTransition></SidebarInset>
 *   </SidebarProvider>
 *
 * SidebarProvider lives here so context is available to both the sidebar and
 * SidebarInset children. SidebarInset is placed in layout.tsx, not here, per the
 * task-22 spec: <AppSidebar /> + <SidebarInset>.
 */
export function AppSidebar() {
  const pathname = usePathname();
  const search = useSearchParams();

  const filterQuery = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = search.get(key);
    if (value) filterQuery.set(key, value);
  }
  if (search.get("range")) filterQuery.set("range", search.get("range")!);
  const qs = filterQuery.size ? `?${filterQuery}` : "";

  if (pathname === "/login") return null;

  return (
    <Sidebar collapsible="icon" className="bg-sidebar">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/" aria-label="Trade Journal home" />}
              size="lg"
              tooltip="Trade Journal"
              className="gap-2.5"
            >
              <LuxAlgoMark className="h-[18px] w-5 shrink-0" />
              <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
                Trade Journal
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup aria-label="Main">
          <SidebarMenu>
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              const finalHref = href === "/prop-firms" ? href : href + qs;
              return (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<Link href={finalHref} />}
                    isActive={active}
                    tooltip={label}
                    className={cn(
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", active && "text-[var(--brand)]")} />
                    <span className="truncate">{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarSeparator className="my-3" />

        <SidebarGroup aria-label="Setup">
          <SidebarMenu>
            {NAV_SETUP.map(({ href, label, icon: Icon }) => {
              const active = pathname.startsWith(href);
              const finalHref = href + qs;
              return (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<Link href={finalHref} />}
                    isActive={active}
                    tooltip={label}
                    className={cn(
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 border-t p-3">
        {/*
         * CONCERN (task-22): DictationMenuItem and VoiceNotesMenuItem are named in the brief
         * as custom footer slots to preserve, but neither exists as a standalone component.
         * VoiceNote is a page-level component; it has no sidebar-menu-item variant.
         * DashboardCustomizerMenuItem also does not exist as a sidebar component.
         * Placeholder ghost buttons are rendered here; implement dedicated wrappers if those
         * features migrate into the sidebar.
         */}
        <div className="flex flex-col gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Mic className="h-4 w-4 shrink-0" />
            <span className="truncate text-xs">Dictate</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Settings2 className="h-4 w-4 shrink-0" />
            <span className="truncate text-xs">Customize</span>
          </Button>
        </div>

        {/* Theme + Privacy toggles — collapse to icons when sidebar is collapsed */}
        <SidebarFooterToggles />

        <div className="space-y-1 border-t pt-2 text-xs text-sidebar-foreground/50 group-data-[collapsible=icon]:hidden">
          <div>
            Open source ·{" "}
            <a
              href="https://github.com/LuxAlgo/trade-journal"
              className="underline underline-offset-2 hover:text-sidebar-foreground"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
          <div>Not investment advice.</div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function SidebarFooterToggles() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  return (
    <div className="flex flex-col gap-1">
      <ThemeToggle iconOnly={collapsed} />
      <PrivacyToggle iconOnly={collapsed} />
    </div>
  );
}

/**
 * Shell — layout wrapper: SidebarProvider + AppSidebar + SidebarInset.
 * Existing callers (e.g. tests) that pass {children} get {children} rendered
 * inside SidebarInset. Once callers migrate to the
 * <SidebarProvider><AppSidebar /><SidebarInset> pattern this can be removed.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <PageTransition>{children}</PageTransition>
      </SidebarInset>
    </SidebarProvider>
  );
}
