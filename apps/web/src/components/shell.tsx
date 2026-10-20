"use client";

import Link from "next/link";
import { useEffect } from "react";
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
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
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
  SidebarInset,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { FILTER_KEYS } from "@luxalgo/journal-core";
import { HoverHint } from "@/components/ui/tooltip";

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

/** Keep original navigation geometry without the menu button's forced icon sizing. */
function NavLink({
  href,
  label,
  icon: Icon,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <SidebarMenuItem>
      <HoverHint content={collapsed ? label : null} side="right">
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "journal-sidebar-nav-link relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active
              ? "bg-accent font-medium text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <Icon className={cn("h-4 w-4", active && "text-brand")} />
          <span className="journal-sidebar-label">{label}</span>
        </Link>
      </HoverHint>
    </SidebarMenuItem>
  );
}

/** Compose the backed-up desktop rail and mobile drawer from the shared sidebar state. */
export function AppSidebar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { state, ready, isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const collapsed = !isMobile && state === "collapsed";

  // Route changes close the drawer; the nav click handler also covers same-route links.
  useEffect(() => setOpenMobile(false), [pathname, setOpenMobile]);

  const filterQuery = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = search.get(key);
    if (value) filterQuery.set(key, value);
  }
  const range = search.get("range");
  if (range) filterQuery.set("range", range);
  const qs = filterQuery.size ? `?${filterQuery}` : "";

  return (
    <Sidebar
      collapsible="icon"
      className={isMobile ? "journal-nav-drawer bg-card shadow-2xl" : "journal-desktop-sidebar"}
      data-collapsed={collapsed}
      data-ready={ready}
    >
      {isMobile ? (
        <SidebarHeader className="journal-shell-controls h-14 shrink-0 flex-row items-center gap-2.5 border-b px-4 py-0">
          <LuxAlgoMark className="h-[18px] w-5" />
          <span className="text-sm font-semibold">Trade Journal</span>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8 rounded-md"
            aria-label="Close navigation"
            onClick={() => setOpenMobile(false)}
          >
            <X />
          </Button>
        </SidebarHeader>
      ) : (
        <SidebarHeader className="journal-sidebar-header relative h-14 shrink-0 flex-row items-center gap-0 border-b p-0">
          <Link href="/" className="journal-sidebar-home flex h-full min-w-0 items-center gap-2.5">
            <LuxAlgoMark className="h-[18px] w-5 shrink-0" />
            <span className="journal-sidebar-brand-label text-sm font-semibold tracking-tight">
              Trade Journal
            </span>
          </Link>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="journal-sidebar-trigger absolute h-7 w-7 rounded-full bg-background shadow-sm"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-keyshortcuts="Meta+B Control+B"
            title={`${collapsed ? "Expand" : "Collapse"} sidebar (⌘B)`}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-3.5" />
            ) : (
              <PanelLeftClose className="size-3.5" />
            )}
          </Button>
        </SidebarHeader>
      )}
      <SidebarContent className="overflow-visible group-data-[collapsible=icon]:overflow-visible">
        <nav
          aria-label="Journal navigation"
          className="journal-sidebar-navigation min-h-0 flex-1 space-y-0.5 overflow-x-hidden overflow-y-auto overscroll-contain p-2"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a")) setOpenMobile(false);
          }}
        >
          <SidebarMenu className="gap-0.5">
            {NAV.map(({ href, label, icon }) => (
              <NavLink
                key={href}
                href={href === "/prop-firms" ? href : href + qs}
                label={label}
                icon={icon}
                collapsed={collapsed}
                active={href === "/" ? pathname === "/" : pathname.startsWith(href)}
              />
            ))}
          </SidebarMenu>
          <div className="!my-3 border-t" />
          <SidebarMenu className="gap-0.5">
            {NAV_SETUP.map(({ href, label, icon }) => (
              <NavLink
                key={href}
                href={href + qs}
                label={label}
                icon={icon}
                collapsed={collapsed}
                active={pathname.startsWith(href)}
              />
            ))}
          </SidebarMenu>
        </nav>
      </SidebarContent>
      <SidebarFooter className="journal-shell-controls gap-0 p-0">
        {isMobile ? (
          <div className="border-t p-3">
            <PrivacyToggle />
          </div>
        ) : (
          <div className="journal-sidebar-privacy border-t p-3">
            <div className="w-full space-y-1">
              <ThemeToggle iconOnly={collapsed} />
              <PrivacyToggle iconOnly={collapsed} />
            </div>
          </div>
        )}
        <div className="journal-sidebar-footer space-y-1 border-t p-3 text-xs text-muted-foreground">
          <div>
            Open source ·{" "}
            <a
              href="https://github.com/LuxAlgo/trade-journal"
              className="underline underline-offset-2 hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
          <div>Not investment advice.</div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

/** Keep the mobile trigger outside the portaled drawer so navigation is always reachable. */
function ShellContent({ children }: { children: React.ReactNode }) {
  const { setOpenMobile } = useSidebar();
  return (
    <>
      <header className="journal-mobile-header journal-shell-controls sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-md"
          aria-label="Open navigation"
          onClick={() => setOpenMobile(true)}
        >
          <Menu />
        </Button>
        <Link
          href="/"
          className="mr-auto flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight"
        >
          <LuxAlgoMark className="hidden h-4 w-[18px] shrink-0 min-[380px]:block" />
          <span className="truncate">Trade Journal</span>
        </Link>
        <PrivacyToggle compact />
        <ThemeToggle iconOnly />
      </header>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <PageTransition>{children}</PageTransition>
      </SidebarInset>
    </>
  );
}

/** Login stays unwrapped; all journal pages share the responsive sidebar provider. */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return (
    <SidebarProvider className="journal-shell min-h-dvh flex-col lg:flex-row">
      <ShellContent>{children}</ShellContent>
    </SidebarProvider>
  );
}
