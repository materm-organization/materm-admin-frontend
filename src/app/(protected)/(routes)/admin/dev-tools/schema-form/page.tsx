import { notFound } from "next/navigation";

import { SchemaFormPlayground } from "@/components/schema-form/playground/schema-form-playground";

// /admin/dev-tools/schema-form - manual playground of the schema form engine (T1.2.10): every section type,
// example props, draft / publish, languages, server errors, autosave. Development only: in a production build
// it renders Next's not-found page instead (`notFound()` after streaming started: the HTTP status stays 200, the
// playground itself is never rendered) and it is not in the navigation. (A folder called `_dev` would not be routed by Next.js, hence
// `dev-tools`.) The CMS endpoints do not exist yet, so the pickers read in-memory seed rows.
export default function SchemaFormPlaygroundPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SchemaFormPlayground />;
}
