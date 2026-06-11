import {
  Award,
  Baby,
  Calendar,
  Car,
  Clock,
  Facebook,
  Instagram,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

// Curated icon set for the editable info-list picker. Limited to icons
// already used elsewhere in the app so the visual vocabulary stays
// consistent and the bundle doesn't grow.
export const ICONS: Record<string, LucideIcon> = {
  Clock,
  Calendar,
  Baby,
  MapPin,
  Navigation,
  Car,
  Sparkles,
  Mail,
  Phone,
  Award,
  Facebook,
  Instagram,
};

export const ICON_NAMES = Object.keys(ICONS);

export function getIcon(name: string): LucideIcon {
  return ICONS[name] ?? Clock;
}
