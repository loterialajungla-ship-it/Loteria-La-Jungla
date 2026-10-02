import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireVendorOrAdmin } from "@/lib/auth/guards";
import { AuthError } from "@/lib/auth/errors";
import { prisma } from "@/lib/prisma";
import { TicketNotFoundError } from "@/lib/tickets/errors";
import { getVendorTicketById } from "@/lib/tickets/vendor-tickets";
import { VendorTicketDetalleView } from "@/components/tickets/VendorTicketDetalleView";

export const dynamic = "force-dynamic";

type Props = {
  params: { id: string };
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  try {
    const actor = await requireVendorOrAdmin();
    const ticket = await getVendorTicketById(
      prisma,
      { userId: actor.userId, rol: actor.user.rol },
      params.id,
    );
    return { title: `${ticket.numeroVisible} — Mis tickets` };
  } catch {
    return { title: "Ticket — Mis tickets" };
  }
}

export default async function VentaTicketDetallePage({ params }: Props) {
  let actor;
  try {
    actor = await requireVendorOrAdmin();
  } catch (e) {
    if (e instanceof AuthError) redirect("/login");
    redirect("/login");
  }

  let ticket;
  try {
    ticket = await getVendorTicketById(
      prisma,
      { userId: actor.userId, rol: actor.user.rol },
      params.id,
    );
  } catch (e) {
    if (e instanceof TicketNotFoundError) notFound();
    throw e;
  }

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <VendorTicketDetalleView ticket={ticket} />
    </div>
  );
}
