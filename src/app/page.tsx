import { redirect } from "next/navigation";

// No token check here (that's a client concern, see the `(protected)`
// layout guard) — `/` just points at the sign-in page; an already
// authenticated visitor lands on it and the guard on `/admin` is what
// actually decides where they end up next.
export default function RootPage() {
  redirect("/auth/sign-in");
}
