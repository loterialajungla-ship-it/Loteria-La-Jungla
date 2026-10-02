import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ANIMALES: { numero: string; nombre: string }[] = [
  { numero: "0", nombre: "Delfín" },
  { numero: "00", nombre: "Ballena" },
  { numero: "01", nombre: "Carnero" },
  { numero: "02", nombre: "Toro" },
  { numero: "03", nombre: "Ciempiés" },
  { numero: "04", nombre: "Alacrán" },
  { numero: "05", nombre: "León" },
  { numero: "06", nombre: "Rana" },
  { numero: "07", nombre: "Perico" },
  { numero: "08", nombre: "Ratón" },
  { numero: "09", nombre: "Águila" },
  { numero: "10", nombre: "Tigre" },
  { numero: "11", nombre: "Gato" },
  { numero: "12", nombre: "Caballo" },
  { numero: "13", nombre: "Mono" },
  { numero: "14", nombre: "Paloma" },
  { numero: "15", nombre: "Zorro" },
  { numero: "16", nombre: "Oso" },
  { numero: "17", nombre: "Pavo" },
  { numero: "18", nombre: "Burro" },
  { numero: "19", nombre: "Chivo" },
  { numero: "20", nombre: "Cochino" },
  { numero: "21", nombre: "Gallo" },
  { numero: "22", nombre: "Camello" },
  { numero: "23", nombre: "Cebra" },
  { numero: "24", nombre: "Iguana" },
  { numero: "25", nombre: "Gallina" },
  { numero: "26", nombre: "Vaca" },
  { numero: "27", nombre: "Perro" },
  { numero: "28", nombre: "Zamuro" },
  { numero: "29", nombre: "Elefante" },
  { numero: "30", nombre: "Caimán" },
  { numero: "31", nombre: "Lapa" },
  { numero: "32", nombre: "Ardilla" },
  { numero: "33", nombre: "Pescado" },
  { numero: "34", nombre: "Venado" },
  { numero: "35", nombre: "Jirafa" },
  { numero: "36", nombre: "Culebra" },
];

async function main() {
  for (const animal of ANIMALES) {
    const imagen = `/animals/${animal.numero}.png`;

    await prisma.animal.upsert({
      where: { numero: animal.numero },
      update: {
        nombre: animal.nombre,
        imagen,
      },
      create: {
        numero: animal.numero,
        nombre: animal.nombre,
        imagen,
      },
    });
  }

  console.log(`Seed completado: ${ANIMALES.length} animalitos.`);

  await prisma.configNegocio.upsert({
    where: { clave: "MULTIPLICADOR_PREMIO" },
    update: { valorInt: 30 },
    create: {
      clave: "MULTIPLICADOR_PREMIO",
      valorInt: 30,
    },
  });

  console.log("ConfigNegocio: MULTIPLICADOR_PREMIO = 30");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
