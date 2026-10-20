import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

// Small dedicated brand/vector-icon map — kept separate from direct
// lucide-react imports so it's obvious at a glance which icons are "system"
// icons vs. one-off brand assets. Only the app logo is needed today.
export const Icons = {
  logo: ({ className }: React.ComponentProps<"div">) => (
    <Avatar className={className}>
      <AvatarImage src="/logo.png" />
      <AvatarFallback>CN</AvatarFallback>
    </Avatar>
  ),
};
