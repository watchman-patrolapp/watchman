import {
  REGISTER_VEHICLE_TYPE_OPTIONS,
  isLightMobilityVehicleType,
  getLightMobilityDefaultModel,
} from "../../utils/vehicleTypeConstants";

const VEHICLE_COLORS = [
  "gray", "red", "blue", "green", "black", "white", "silver", "yellow", "orange",
];

export default function RegisterVehicleFields({ form, onChange }) {
  const lightMobility = isLightMobilityVehicleType(form.vehicleType);
  const showVehicleColor = !lightMobility && form.vehicleType !== "boat";

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="reg-vehicle-type" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
          Patrol mode / vehicle type <span className="text-red-500" aria-hidden>*</span>
        </label>
        <select
          id="reg-vehicle-type"
          name="vehicleType"
          value={form.vehicleType}
          onChange={onChange}
          className="input border w-full"
          required
        >
          {REGISTER_VEHICLE_TYPE_OPTIONS.map((type) => (
            <option key={type.value} value={type.value}>{type.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="reg-car-type" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
          {form.vehicleType === "boat"
            ? "Boat name"
            : form.vehicleType === "motorcycle"
              ? "Make & model"
              : form.vehicleType === "bicycle"
                ? "Bicycle description"
                : "Car type"}{" "}
          <span className="text-red-500" aria-hidden>*</span>
        </label>
        <input
          id="reg-car-type"
          name="carType"
          type="text"
          placeholder={
            lightMobility
              ? getLightMobilityDefaultModel(form.vehicleType)
              : form.vehicleType === "bicycle"
                ? "e.g. Mountain bike"
                : form.vehicleType === "boat"
                  ? "e.g. Sea Ray"
                  : form.vehicleType === "motorcycle"
                    ? "e.g. Honda CB500"
                    : "e.g. Toyota Corolla"
          }
          value={form.carType}
          onChange={onChange}
          className="input border w-full disabled:opacity-70"
          disabled={lightMobility}
          required={!lightMobility}
        />
        {lightMobility && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Set automatically for this patrol mode (no extra details).
          </p>
        )}
      </div>

      <div>
        <label htmlFor="reg-reg" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
          {form.vehicleType === "motorcycle" ? "Number plate" : "Registration number"}{" "}
          <span className="text-red-500" aria-hidden>*</span>
        </label>
        <input
          id="reg-reg"
          name="regNumber"
          type="text"
          placeholder={
            lightMobility
              ? "N/A"
              : form.vehicleType === "bicycle"
                ? "Bicycle ID or frame number"
                : form.vehicleType === "motorcycle"
                  ? "e.g. GP 123-456"
                  : form.vehicleType === "boat"
                    ? "Hull or registration ID"
                    : "Registration number"
          }
          value={form.regNumber}
          onChange={onChange}
          className="input border w-full disabled:opacity-70"
          disabled={lightMobility}
          required={!lightMobility}
        />
      </div>

      {showVehicleColor ? (
        <div>
          <label htmlFor="reg-color" className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
            Vehicle color <span className="text-red-500" aria-hidden>*</span>
          </label>
          <select
            id="reg-color"
            name="vehicleColor"
            value={form.vehicleColor}
            onChange={onChange}
            className="input border w-full"
            required
          >
            {VEHICLE_COLORS.map((color) => (
              <option key={color} value={color}>
                {color.charAt(0).toUpperCase() + color.slice(1)}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}
