export function updateVehiclePosition(
  vehicleMesh,
  curve,
  progress,
  surfaceY = 0,
) {
  const point = curve.getPointAt(Math.min(Math.max(progress, 0), 1));
  const tangent = curve.getTangentAt(Math.min(Math.max(progress, 0), 1));
  point.y = surfaceY;
  vehicleMesh.position.copy(point);
  vehicleMesh.lookAt(point.clone().add(tangent));
}

function interpolateOpponent(mesh, currentProgress, targetProgress, dt) {
  const next =
    currentProgress + (targetProgress - currentProgress) * Math.min(dt * 5, 1);
  return next;
}
