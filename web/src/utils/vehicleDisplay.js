import { normalizeVehicleType } from '../components/VehicleIcon';

/**
 * Human-readable vehicle line for patrol cards (matches admin dashboard).
 */
export function getVehicleDisplayText(
  vehicle_type,
  car_type,
  vehicle_make_model,
  vehicle_reg,
  reg_number
) {
  const type = normalizeVehicleType(vehicle_type, car_type);

  if (type === 'on_foot') {
    return 'On foot';
  }

  const makeModel = vehicle_make_model || car_type || 'Car';
  const registration = vehicle_reg || reg_number;

  if (type === 'bicycle') {
    const sourceLabel = (vehicle_make_model || car_type || '').trim();
    const normalizedSource = sourceLabel.toLowerCase();
    const isGenericBike = ['bicycle', 'bike'].includes(normalizedSource);
    if (sourceLabel && !isGenericBike) {
      return `${sourceLabel}${registration ? ` (${registration})` : ''}`;
    }
    return registration ? `Bicycle (${registration})` : 'Bicycle';
  }

  return `${makeModel}${registration ? ` (${registration})` : ''}`;
}
