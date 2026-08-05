struct RayPayload { float3 color; };

[shader("miss")]
void Miss(inout RayPayload payload)
{
	payload.color = float3(0.05, 0.1, 0.15);
}
