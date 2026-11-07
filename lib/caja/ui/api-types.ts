export type CajaTotalesDto = {
  totalBruto: string;
  totalComision: string;
  totalObligado: string;
  totalDeclarado: string;
  totalConfirmado: string;
  totalAplicado: string;
  pendienteAplicar: string;
  totalPendienteObligaciones: string;
  deudaPendienteEntregar: string;
  pendienteConfirmar: string;
  pendienteDeclarar: string;
  maxNuevaDeclaracion: string;
};

export type CajaDeclaracionDto = {
  id: string;
  vendedorId: string;
  importeDeclarado: string;
  declaradoAt: string;
  nota: string | null;
  totalConfirmado: string;
  pendienteConfirmar: string;
  estado: "PENDIENTE" | "PARCIAL" | "CONFIRMADA";
};

export type CajaConfirmacionDto = {
  id: string;
  declaracionId: string;
  importeConfirmado: string;
  confirmadoPorAdminId: string;
  confirmadoAt: string;
};

export type CajaAplicacionDto = {
  id: string;
  confirmacionId: string;
  obligacionId: string;
  vendedorId: string;
  importeAplicado: string;
  createdAt: string;
  ticketId: string | null;
  ticketCreatedAt: string | null;
};

export type CajaObligacionDto = {
  obligacionId: string;
  ticketId: string;
  ticketCreatedAt: string;
  vendedorId: string;
  bruto: string;
  comisionPorcentaje: string;
  comisionImporte: string;
  importeAdmin: string;
  totalAplicado: string;
  pendiente: string;
};

export type CajaAdminListResponse = {
  ok: true;
  caja: {
    activa: boolean;
    activadaEn: string | null;
    configPersisted: boolean;
  };
  totales: CajaTotalesDto;
  vendedores: Array<{
    vendedorId: string;
    nombre: string | null;
    usuario: string | null;
    activo: boolean;
    comisionPorcentaje: string | null;
    totales: CajaTotalesDto;
  }>;
};

export type CajaVendorResumenResponse = {
  ok: true;
  vendedorId: string;
  totales: CajaTotalesDto;
  declaraciones: CajaDeclaracionDto[];
  confirmaciones: CajaConfirmacionDto[];
  aplicaciones: CajaAplicacionDto[];
  obligaciones: CajaObligacionDto[];
};

export type CajaApiError = {
  ok: false;
  error: { code: string; message: string };
};
