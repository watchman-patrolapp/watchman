import { FaEnvelope, FaMapMarkerAlt, FaPhone, FaUser } from 'react-icons/fa';
import { ProfileVehicleGlyph } from '../../components/VehicleIcon';

export default function DashboardProfileCard({
  user,
  primaryVehicle,
  primaryVehicleSummaryText,
}) {
  return (
    <div className="lg:col-span-5 bento-tile overflow-hidden flex flex-col min-h-[12rem]">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Your profile</h2>
      </div>
      <div className="p-5 space-y-3 flex-1">
        <div className="flex items-center space-x-3">
          <FaUser className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
          <span className="text-gray-700 dark:text-gray-300 text-sm">
            <span className="font-medium">Name:</span> {user?.fullName || "Not provided"}
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <FaMapMarkerAlt className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
          <span className="text-gray-700 dark:text-gray-300 text-sm">
            <span className="font-medium">Address:</span> {user?.address || "Not provided"}
          </span>
        </div>
        {primaryVehicle ? (
          <div className="flex items-center space-x-3">
            <ProfileVehicleGlyph
              type={primaryVehicle.vehicle_type}
              carType={primaryVehicle.car_type || user.carType}
            />
            <span className="text-gray-700 dark:text-gray-300 text-sm">
              <span className="font-medium">Primary vehicle:</span>{" "}
              {primaryVehicleSummaryText}
            </span>
          </div>
        ) : (user?.carType || user?.registrationNumber) && (
          <div className="flex items-center space-x-3">
            <ProfileVehicleGlyph
              type={user.carType}
              carType={user.registrationNumber ? 'car' : null}
            />
            <span className="text-gray-700 dark:text-gray-300 text-sm">
              <span className="font-medium">Vehicle:</span>{" "}
              {user.carType && user.registrationNumber
                ? `${user.carType} (${user.registrationNumber})`
                : user.carType || user.registrationNumber}
            </span>
          </div>
        )}
        <div className="flex items-center space-x-3">
          <FaEnvelope className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
          <span className="text-gray-700 dark:text-gray-300 text-sm break-all">
            <span className="font-medium">Email:</span> {user?.email}
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <FaPhone className="text-teal-500 dark:text-teal-400 w-5 h-5 shrink-0" />
          <span className="text-gray-700 dark:text-gray-300 text-sm">
            <span className="font-medium">Phone:</span> {user?.phone?.trim() ? user.phone : 'Not provided'}
          </span>
        </div>
      </div>
    </div>
  );
}
