async function createDriver() {
  const payload = {
    firstName: "Prueba",
    lastName: "Taxote",
    email: "test@taxote.online",
    phone: "8090000000",
    password: "123b123",
    cedula: "00000000000",
    vehicleType: "Sedán",
    vehicleBrand: "Toyota",
    vehicleModel: "Corolla",
    vehicleColor: "Blanco",
    vehiclePlate: "TEST001",
    selfiePhoto: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    idFront: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    vehiclePhoto: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  };

  try {
    const response = await fetch("https://taxote.online/api/driver/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    console.log(JSON.stringify(data));
  } catch (error) {
    console.error(error.message);
  }
}

createDriver();
