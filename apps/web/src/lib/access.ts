import { auth } from "../../auth";

export async function authorizedUser() {
  const session = await auth();
  if (!session?.user) return null;
  return session.user;
}

export async function hodUser() {
  const user = await authorizedUser();
  return user?.role === "HOD" ? user : null;
}
