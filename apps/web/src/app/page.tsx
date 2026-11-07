import { redirect } from "next/navigation";
import { auth } from "../../auth";
import Dashboard from "@/components/dashboard";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return (
    <Dashboard
      user={{
        id: session.user.id,
        name: session.user.name ?? "Faculty member",
        email: session.user.email ?? "",
        role: session.user.role,
        facultyId: session.user.facultyId,
      }}
    />
  );
}
