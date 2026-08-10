package com.taxote.driver;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class VehicleCatalog {
    public static final String[] TYPES = {
        "Selecciona el tipo", "Sedán", "SUV", "Hatchback", "Minivan", "Camioneta", "Van"
    };

    public static final String[] COLORS = {
        "Selecciona el color", "Blanco", "Negro", "Gris", "Plata", "Azul", "Azul oscuro",
        "Rojo", "Vino", "Verde", "Amarillo", "Naranja", "Marrón", "Beige", "Dorado", "Morado"
    };

    private static final LinkedHashMap<String, List<String>> MODELS = new LinkedHashMap<>();

    static {
        add("Toyota", "Corolla", "Camry", "Yaris", "RAV4", "Rush", "Raize", "Avanza", "Hilux", "Fortuner", "Land Cruiser Prado");
        add("Honda", "Civic", "Accord", "City", "Fit", "CR-V", "HR-V", "Pilot", "Odyssey");
        add("Hyundai", "Accent", "Elantra", "Sonata", "Venue", "Creta", "Tucson", "Santa Fe", "Palisade", "H-1", "Staria");
        add("Kia", "Picanto", "Rio", "K3 / Forte", "K5 / Optima", "Soul", "Seltos", "Sportage", "Sorento", "Carnival");
        add("Nissan", "Versa", "Sentra", "Altima", "Kicks", "Qashqai", "Rogue / X-Trail", "Pathfinder", "Frontier", "Urvan");
        add("Chevrolet", "Spark", "Aveo", "Onix", "Cruze", "Trax", "Captiva", "Equinox", "Tahoe", "Colorado");
        add("Ford", "Fiesta", "Focus", "Fusion", "EcoSport", "Escape", "Edge", "Explorer", "Ranger", "Transit");
        add("Mitsubishi", "Mirage", "Lancer", "ASX", "Eclipse Cross", "Outlander", "Montero Sport", "L200");
        add("Suzuki", "S-Presso", "Swift", "Dzire", "Ciaz", "Fronx", "Vitara", "Ertiga", "Jimny");
        add("Mazda", "Mazda2", "Mazda3", "Mazda6", "CX-3", "CX-30", "CX-5", "CX-9");
        add("Volkswagen", "Gol", "Polo", "Jetta", "Passat", "Golf", "T-Cross", "Taos", "Tiguan");
        add("Renault", "Logan", "Sandero", "Duster", "Koleos", "Kwid", "Oroch", "Master");
        add("Peugeot", "208", "301", "308", "2008", "3008", "5008", "Partner");
        add("Jeep", "Renegade", "Compass", "Cherokee", "Grand Cherokee", "Wrangler");
        add("Subaru", "Impreza", "Legacy", "Crosstrek", "Forester", "Outback", "Ascent");
        add("Mercedes-Benz", "Clase A", "Clase C", "Clase E", "CLA", "GLA", "GLC", "GLE", "Vito");
        add("BMW", "Serie 1", "Serie 3", "Serie 5", "X1", "X3", "X5");
        add("Lexus", "IS", "ES", "LS", "UX", "NX", "RX", "GX");
        add("Changan", "Alsvin", "Eado", "CS15", "CS35 Plus", "CS55 Plus", "CS75 Plus", "Hunter");
        add("Chery", "Arrizo 5", "Tiggo 2", "Tiggo 4", "Tiggo 7", "Tiggo 8");
        add("Geely", "Emgrand", "Coolray", "GX3 Pro", "Azkarra", "Okavango");
        add("BYD", "Dolphin", "Seagull", "Qin Plus", "Song Plus", "Yuan Plus", "Tang");
        add("Dongfeng", "Aeolus Yixuan", "Aeolus Huge", "Rich 6", "T5 EVO", "M5 EV");
        add("JAC", "J4", "JS2", "JS3", "JS4", "JS6", "T8");
    }

    private VehicleCatalog() {}

    private static void add(String brand, String... models) {
        MODELS.put(brand, Arrays.asList(models));
    }

    public static String[] brands() {
        ArrayList<String> values = new ArrayList<>();
        values.add("Selecciona la marca");
        values.addAll(MODELS.keySet());
        return values.toArray(new String[0]);
    }

    public static String[] modelsFor(String brand) {
        ArrayList<String> values = new ArrayList<>();
        values.add("Selecciona el modelo");
        List<String> models = MODELS.get(brand);
        if (models != null) values.addAll(models);
        return values.toArray(new String[0]);
    }

    public static Map<String, List<String>> all() {
        return MODELS;
    }
}
