/** VERIFIED: scripts/e2e.ts fails on the console error an unknown icon logs, and checks that no `i[data-lucide]`
 * placeholder stays in the page. Lucide icons, imported one by one so the bundle carries only these. The static shell
 * gets them once at startup through `createIcons`; rendered regions use `<Icon>`, which morph renders as SVG
 * directly. Why not `createIcons` after each render: it swaps placeholders for SVG behind morph's back, so the next
 * morph would put the placeholders back and every render would rebuild every icon. */
import {
  AtSign,
  Bell,
  Box,
  Calendar,
  CalendarX,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  CircleCheck,
  CircleDot,
  CircleUserRound,
  Copy,
  Inbox,
  Keyboard,
  Layers,
  Link,
  List,
  ListFilter,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Signal,
  SquareKanban,
  SquarePen,
  Star,
  Table2,
  Tag,
  Trash2,
  UserPlus,
  UserRound,
  X,
  type IconNode,
} from "lucide";

/** Keyed by Lucide's PascalCase name, as `createIcons` looks them up. */
export const ICONS: Record<string, IconNode> = {
  AtSign,
  Bell,
  Box,
  Calendar,
  CalendarX,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  CircleCheck,
  CircleDot,
  CircleUserRound,
  Copy,
  Inbox,
  Keyboard,
  Layers,
  Link,
  List,
  ListFilter,
  LogOut,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings,
  Signal,
  SquareKanban,
  SquarePen,
  Star,
  Table2,
  Tag,
  Trash2,
  UserPlus,
  UserRound,
  X,
};

const pascal = (name: string) => name.replace(/(^|-)([a-z0-9])/g, (_m, _dash, c: string) => c.toUpperCase());

/** A Lucide icon by its kebab-case name (`message-square`), with the attributes `createIcons` gives it. */
export function Icon({ name }: { name: string }) {
  const node = ICONS[pascal(name)];
  if (!node) {
    console.error("Unknown icon " + name);
    return null;
  }
  return (
    <svg
      class={"lucide lucide-" + name}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {node.map(([tag, attrs]) => {
        const Tag = tag;
        return <Tag {...attrs} />;
      })}
    </svg>
  );
}
