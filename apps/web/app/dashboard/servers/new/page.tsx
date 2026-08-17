import { redirect } from "next/navigation";

export default function LegacyCreateServerRoute() {
  redirect("/dashboard/deploy");
}
