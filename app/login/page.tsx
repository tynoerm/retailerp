import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";
import { getSessionUser } from "../lib/auth";
import { safeRedirect } from "../lib/permissions";

export const metadata: Metadata = { title: "Sign in • RetailERP" };

export default async function LoginPage(props: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await props.searchParams;
  const target = safeRedirect(next);

  if (await getSessionUser().catch(() => null)) redirect(target);

  return <LoginForm next={target} />;
}
