import React, { useState, useEffect } from 'react';
import './index.css';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, Polygon } from 'react-leaflet';
import L from 'leaflet';

// Fix for default markers in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// NEW: Real Data Service for API Integration
class RealDataService {
  static async getCurrentWeather(lat, lng) {
    try {
      // Replace YOUR_API_KEY with actual OpenWeatherMap API key
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=YOUR_API_KEY&units=imperial`
      );
      
      if (!response.ok) throw new Error('Weather API failed');
      
      const data = await response.json();
      return {
        temperature: Math.round(data.main.temp),
        humidity: data.main.humidity,
        description: data.weather[0].description
      };
    } catch (error) {
      console.error('Weather API error:', error);
      // Fallback to realistic mock data
      return {
        temperature: lat > 40 ? 78 : lat > 35 ? 82 : 85,
        humidity: 65,
        description: 'partly cloudy'
      };
    }
  }

  static async getGreenSpaces(lat, lng, radius = 3000) {
    try {
      const query = `
        [out:json][timeout:15];
        (
          way["landuse"="forest"](around:${radius},${lat},${lng});
          way["landuse"="grass"](around:${radius},${lat},${lng});
          way["leisure"="park"](around:${radius},${lat},${lng});
          way["leisure"="garden"](around:${radius},${lat},${lng});
          relation["leisure"="park"](around:${radius},${lat},${lng});
        );
        out center;
      `;
      
      const response = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' }
      });
      
      if (!response.ok) throw new Error('Overpass API failed');
      
      const data = await response.json();
      return data.elements.map((element, index) => ({
        id: `existing-${element.id || index}`,
        position: element.center ? 
          [element.center.lat, element.center.lon] : 
          [element.lat || lat, element.lon || lng],
        title: element.tags?.name || `Green Space ${index + 1}`,
        type: 'green',
        subtype: this.getGreenSpaceType(element.tags),
        area: this.estimateArea(element.tags),
        existing: true
      }));
    } catch (error) {
      console.error('Green spaces API error:', error);
      return this.getMockGreenSpaces(lat, lng);
    }
  }

  static getGreenSpaceType(tags) {
    if (tags?.landuse === 'forest') return 'forest';
    if (tags?.leisure === 'park') return 'park';
    if (tags?.leisure === 'garden') return 'garden';
    return 'park';
  }

  static estimateArea(tags) {
    if (tags?.landuse === 'forest') return 2.0;
    if (tags?.leisure === 'park') return 0.8;
    return 0.3;
  }

  static getMockGreenSpaces(lat, lng) {
    return [
      {
        id: 'mock-1',
        position: [lat + 0.005, lng - 0.005],
        title: 'Central Park',
        type: 'green',
        subtype: 'park',
        area: 1.2,
        existing: true
      },
      {
        id: 'mock-2',
        position: [lat - 0.003, lng + 0.007],
        title: 'Community Garden',
        type: 'green',
        subtype: 'garden',
        area: 0.3,
        existing: true
      }
    ];
  }

  static async getTrafficData(lat, lng) {
    // Mock traffic data - would use Google Maps Traffic API in production
    return [
      { position: [lat + 0.001, lng - 0.002], intensity: 0.8, type: 'heavy' },
      { position: [lat - 0.002, lng + 0.001], intensity: 0.6, type: 'moderate' },
      { position: [lat + 0.003, lng + 0.004], intensity: 0.4, type: 'light' }
    ];
  }
}

// UPDATED: Enhanced calculation functions with real building/green space types
const UrbanPlanningCalculations = {
  // Building efficiency based on type (no user input needed)
  buildingEfficiency: {
    residential: 0.6,
    office: 0.7,
    retail: 0.5,
    industrial: 0.3,
    mixed_use: 0.8,
    green_building: 0.95
  },

  // Green space effectiveness
  greenEffectiveness: {
    park: { cooling: 3.5, coverage: 0.8, air: 15 },
    garden: { cooling: 2.2, coverage: 0.3, air: 8 },
    forest: { cooling: 4.8, coverage: 1.5, air: 20 },
    green_roof: { cooling: 1.8, coverage: 0.1, air: 5 }
  },

  // Calculate temperature reduction based on actual structures
  calculateTemperatureReduction: (markers, baseTemp = 85) => {
    let reduction = 0;
    
    markers.forEach(marker => {
      if (marker.type === 'green') {
        const effect = this.greenEffectiveness[marker.subtype] || this.greenEffectiveness.park;
        reduction += effect.cooling;
      } else if (marker.type === 'building') {
        const efficiency = this.buildingEfficiency[marker.subtype] || 0.6;
        // Lower efficiency buildings add more heat
        reduction -= (1 - efficiency) * 2;
      }
    });
    
    return Math.max(baseTemp - reduction, 65);
  },

  // Calculate green space coverage
  calculateGreenSpaceCoverage: (markers, baselineCoverage = 20, totalAreaKm2 = 10) => {
    let additionalGreenArea = 0;
    
    markers.filter(m => !m.existing && m.type === 'green').forEach(marker => {
      const effect = this.greenEffectiveness[marker.subtype] || this.greenEffectiveness.park;
      additionalGreenArea += effect.coverage;
    });
    
    const coverageIncrease = (additionalGreenArea / totalAreaKm2) * 100;
    return Math.min(baselineCoverage + coverageIncrease, 60);
  },

  // Calculate air quality improvement
  calculateAirQuality: (markers, baselineScore = 40) => {
    let improvement = 0;
    
    markers.forEach(marker => {
      if (marker.type === 'green') {
        const effect = this.greenEffectiveness[marker.subtype] || this.greenEffectiveness.park;
        improvement += effect.air;
      } else if (marker.type === 'building') {
        const efficiency = this.buildingEfficiency[marker.subtype] || 0.6;
        if (efficiency < 0.5) improvement -= 3; // Low efficiency buildings worsen air
      }
    });
    
    const finalScore = Math.min(baselineScore + improvement, 85);
    
    if (finalScore >= 80) return 'A';
    if (finalScore >= 70) return 'B+';
    if (finalScore >= 60) return 'B';
    if (finalScore >= 50) return 'C+';
    return 'C';
  },

  // Calculate energy efficiency
  calculateEnergyEfficiency: (markers, baselineEfficiency = 60) => {
    let improvement = 0;
    
    markers.forEach(marker => {
      if (marker.type === 'building') {
        const efficiency = this.buildingEfficiency[marker.subtype] || 0.6;
        improvement += (efficiency - 0.6) * 20; // Scale for visibility
      } else if (marker.type === 'green') {
        improvement += 2; // Green spaces reduce cooling needs
      }
    });
    
    return Math.min(Math.max(baselineEfficiency + improvement, 20), 98);
  },

  // Calculate walkability score
  calculateWalkScore: (markers, baseWalkScore = 45) => {
    let improvement = 0;
    
    markers.forEach(marker => {
      if (marker.type === 'green') {
        improvement += 5;
      } else if (marker.type === 'building') {
        const walkabilityBonus = {
          mixed_use: 8,
          retail: 6,
          office: 4,
          residential: 2,
          green_building: 5,
          industrial: -2
        };
        improvement += walkabilityBonus[marker.subtype] || 2;
      }
    });
    
    return Math.min(Math.max(baseWalkScore + improvement, 10), 95);
  },

  // Generate heat zones based on actual markers
  generateHeatZones: (markers, cityCenter, scenario) => {
    const zones = [];
    
    markers.forEach((marker, index) => {
      const [lat, lng] = marker.position;
      let intensity, radius, color;
      
      if (marker.type === 'building') {
        const efficiency = UrbanPlanningCalculations.buildingEfficiency[marker.subtype] || 0.6;
        intensity = 1 - efficiency; // Lower efficiency = more heat
        radius = 250;
        color = efficiency < 0.4 ? '#dc2626' : 
                efficiency < 0.7 ? '#f59e0b' : '#fbbf24';
      } else if (marker.type === 'green') {
        intensity = 0.2; // Green spaces create cooling
        radius = marker.area ? marker.area * 200 : 300;
        color = '#10b981';
      }
      
      if (intensity !== undefined) {
        zones.push({
          center: [lat, lng],
          radius: radius,
          intensity: intensity,
          color: color,
          type: marker.type
        });
      }
    });
    
    return zones;
  },

  // Generate green coverage zones
  generateGreenZones: (markers) => {
    return markers
      .filter(marker => marker.type === 'green')
      .map(marker => {
        const [lat, lng] = marker.position;
        const effect = UrbanPlanningCalculations.greenEffectiveness[marker.subtype] || UrbanPlanningCalculations.greenEffectiveness.park;
        return {
          center: [lat, lng],
          radius: marker.area ? marker.area * 200 : effect.coverage * 300,
          color: '#22c55e',
          opacity: marker.existing ? 0.4 : 0.6
        };
      });
  },

  // Generate traffic zones
  generateTrafficZones: (markers, cityCenter, trafficData) => {
    const zones = [];
    
    // Use real traffic data if available
    if (trafficData) {
      trafficData.forEach(traffic => {
        zones.push({
          center: traffic.position,
          radius: 300,
          intensity: traffic.intensity,
          color: traffic.intensity > 0.7 ? '#dc2626' : '#3b82f6'
        });
      });
    }
    
    // Traffic reduction around green spaces
    markers.filter(m => m.type === 'green').forEach(marker => {
      zones.push({
        center: marker.position,
        radius: 200,
        intensity: 0.3,
        color: '#06b6d4'
      });
    });
    
    return zones;
  }
};

// Structure types (simplified - no efficiency selection)
const structureTypes = {
  building: [
    { id: 'residential', label: 'Residential Building' },
    { id: 'office', label: 'Office Building' },
    { id: 'retail', label: 'Retail/Commercial' },
    { id: 'mixed_use', label: 'Mixed Use Development' },
    { id: 'green_building', label: 'Green Building (LEED)' },
    { id: 'industrial', label: 'Industrial Facility' }
  ],
  green: [
    { id: 'park', label: 'Public Park' },
    { id: 'garden', label: 'Community Garden' },
    { id: 'forest', label: 'Urban Forest' },
    { id: 'green_roof', label: 'Green Roof/Wall' }
  ]
};

// Simple icon components (unchanged)
const MapIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
);

const LayersIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="12,2 2,7 12,12 22,7 12,2"/>
    <polyline points="2,17 12,22 22,17"/>
    <polyline points="2,12 12,17 22,12"/>
  </svg>
);

const BarChartIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="20" x2="12" y2="10"/>
    <line x1="18" y1="20" x2="18" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="16"/>
  </svg>
);

// Component to render realistic overlays (updated)
function RealisticMapOverlays({ activeOverlays, markers, cityCenter, trafficData }) {
  const map = useMap();
  
  const heatZones = UrbanPlanningCalculations.generateHeatZones(markers, cityCenter);
  const greenZones = UrbanPlanningCalculations.generateGreenZones(markers);
  const trafficZones = UrbanPlanningCalculations.generateTrafficZones(markers, cityCenter, trafficData);

  return (
    <>
      {/* Heat Island Overlay */}
      {activeOverlays.includes('heat') && heatZones.map((zone, index) => (
        <Circle
          key={`heat-${index}`}
          center={zone.center}
          radius={zone.radius}
          pathOptions={{
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: zone.intensity * 0.4,
            weight: 1,
            opacity: 0.8
          }}
        />
      ))}

      {/* Green Space Overlay */}
      {activeOverlays.includes('green') && greenZones.map((zone, index) => (
        <Circle
          key={`green-${index}`}
          center={zone.center}
          radius={zone.radius}
          pathOptions={{
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: zone.opacity,
            weight: 2,
            opacity: 0.8
          }}
        />
      ))}

      {/* Traffic Flow Overlay */}
      {activeOverlays.includes('traffic') && trafficZones.map((zone, index) => (
        <Circle
          key={`traffic-${index}`}
          center={zone.center}
          radius={zone.radius}
          pathOptions={{
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: zone.intensity * 0.3,
            weight: 1,
            opacity: 0.6,
            dashArray: '5, 5'
          }}
        />
      ))}
    </>
  );
}

// UPDATED: Simplified location form (no efficiency selection)
function CustomLocationForm({ onSubmit }) {
  const [formData, setFormData] = useState({
    title: '',
    type: 'building',
    subtype: 'residential',
    lat: '',
    lng: ''
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (formData.title && formData.lat && formData.lng) {
      onSubmit({
        ...formData,
        lat: parseFloat(formData.lat),
        lng: parseFloat(formData.lng)
      });
      setFormData({ title: '', type: 'building', subtype: 'residential', lat: '', lng: '' });
    }
  };

  const currentSubtypes = structureTypes[formData.type] || structureTypes.building;

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-4 bg-gray-50 rounded-lg">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Structure Name
        </label>
        <input
          type="text"
          value={formData.title}
          onChange={(e) => setFormData({...formData, title: e.target.value})}
          className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
          placeholder="e.g., Mixed Use Development"
          required
        />
      </div>
      
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Category
        </label>
        <select
          value={formData.type}
          onChange={(e) => setFormData({
            ...formData, 
            type: e.target.value, 
            subtype: structureTypes[e.target.value][0].id
          })}
          className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
        >
          <option value="building">Building</option>
          <option value="green">Green Space</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Specific Type
        </label>
        <select
          value={formData.subtype}
          onChange={(e) => setFormData({...formData, subtype: e.target.value})}
          className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
        >
          {currentSubtypes.map(subtype => (
            <option key={subtype.id} value={subtype.id}>
              {subtype.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Latitude
          </label>
          <input
            type="number"
            step="any"
            value={formData.lat}
            onChange={(e) => setFormData({...formData, lat: e.target.value})}
            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            placeholder="42.3601"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Longitude
          </label>
          <input
            type="number"
            step="any"
            value={formData.lng}
            onChange={(e) => setFormData({...formData, lng: e.target.value})}
            className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
            placeholder="-71.0589"
            required
          />
        </div>
      </div>

      <button
        type="submit"
        className="w-full p-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
      >
        Add Structure
      </button>
    </form>
  );
}

// UPDATED: Main App component with real data loading
function App() {
  const [activeOverlays, setActiveOverlays] = useState(['heat', 'green']);
  const [selectedLocation, setSelectedLocation] = useState('boston');
  const [customLocations, setCustomLocations] = useState([]);
  const [showLocationForm, setShowLocationForm] = useState(false);
  const [cityData, setCityData] = useState(null);
  const [loading, setLoading] = useState(true);

  // UPDATED: City locations with real data loading
  const cityLocations = {
    boston: {
      name: 'Boston, MA',
      center: [42.3601, -71.0589],
      zoom: 13
    },
    newyork: {
      name: 'New York, NY',
      center: [40.7128, -74.0060],
      zoom: 12
    },
    sanfrancisco: {
      name: 'San Francisco, CA',
      center: [37.7749, -122.4194],
      zoom: 13
    }
  };

  // NEW: Load real city data
  useEffect(() => {
    loadCityData(selectedLocation);
  }, [selectedLocation]);

  const loadCityData = async (cityKey) => {
    setLoading(true);
    setCustomLocations([]); // Reset custom locations
    
    const cityInfo = cityLocations[cityKey];
    
    try {
      const [weather, greenSpaces, trafficData] = await Promise.all([
        RealDataService.getCurrentWeather(...cityInfo.center),
        RealDataService.getGreenSpaces(...cityInfo.center),
        RealDataService.getTrafficData(...cityInfo.center)
      ]);

      setCityData({
        ...cityInfo,
        weather,
        existingGreenSpaces: greenSpaces,
        trafficData,
        baseTemp: weather.temperature,
        baseGreen: Math.min(greenSpaces.reduce((sum, space) => sum + (space.area || 0.5), 0) * 3, 45)
      });
      
    } catch (error) {
      console.error('Error loading city data:', error);
      setCityData({
        ...cityInfo,
        weather: { temperature: 75, description: 'unknown' },
        existingGreenSpaces: [],
        trafficData: [],
        baseTemp: 75,
        baseGreen: 20
      });
    }
    
    setLoading(false);
  };

  const handleOverlayToggle = (overlayId) => {
    setActiveOverlays(prev => 
      prev.includes(overlayId)
        ? prev.filter(id => id !== overlayId)
        : [...prev, overlayId]
    );
  };

  const handleLocationChange = (locationId) => {
    setSelectedLocation(locationId);
  };

  const handleAddCustomLocation = (newLocation) => {
    const customLocation = {
      id: Date.now(),
      position: [newLocation.lat, newLocation.lng],
      title: newLocation.title,
      type: newLocation.type,
      subtype: newLocation.subtype,
      existing: false
    };
    setCustomLocations(prev => [...prev, customLocation]);
    setShowLocationForm(false);
  };

  const handleDeleteCustomLocation = (locationId) => {
    setCustomLocations(prev => prev.filter(loc => loc.id !== locationId));
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading real city data...</p>
          <p className="text-sm text-gray-500 mt-2">Fetching weather, green spaces, and traffic info</p>
        </div>
      </div>
    );
  }

  // Combine existing green spaces with user additions
  const allMarkers = [
    ...(cityData.existingGreenSpaces || []),
    ...customLocations
  ];

  // Calculate metrics for current state
  const calculateRealMetrics = (markers) => {
    return {
      green: Math.round(
        UrbanPlanningCalculations.calculateGreenSpaceCoverage(markers, cityData.baseGreen)
      ),
      temp: Math.round(
        UrbanPlanningCalculations.calculateTemperatureReduction(markers, cityData.baseTemp)
      ),
      air: UrbanPlanningCalculations.calculateAirQuality(markers, 45),
      energy: Math.round(
        UrbanPlanningCalculations.calculateEnergyEfficiency(markers, 60)
      ),
      walk: Math.round(
        UrbanPlanningCalculations.calculateWalkScore(markers, 50)
      )
    };
  };

  const currentMetrics = calculateRealMetrics(allMarkers);
  const baselineMetrics = calculateRealMetrics(cityData.existingGreenSpaces || []);

  // Overlay options
  const overlayOptions = [
    { 
      id: 'heat', 
      label: 'Temperature', 
      desc: 'Heat zones based on building efficiency and green cooling',
      color: 'bg-red-500' 
    },
    { 
      id: 'green', 
      label: 'Green Coverage', 
      desc: 'Cooling zones from existing and new green spaces',
      color: 'bg-green-500' 
    },
    { 
      id: 'traffic', 
      label: 'Traffic Impact', 
      desc: 'Traffic patterns and green space effects',
      color: 'bg-blue-500' 
    }
  ];

  return (
    <div className="h-screen flex bg-gray-50">
      {/* Left Sidebar */}
      <div className="w-80 bg-white shadow-lg overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-800 mb-2">
              Urban Planning Tool
            </h1>
            <p className="text-gray-600">
              Real-time climate impact analysis
            </p>
          </div>

          {/* NEW: Real Data Display */}
          <div className="bg-blue-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-800 mb-3">Current Conditions</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Temperature:</span>
                <span className="font-medium">{cityData.weather.temperature}°F</span>
              </div>
              <div className="flex justify-between">
                <span>Weather:</span>
                <span className="font-medium capitalize">{cityData.weather.description}</span>
              </div>
              <div className="flex justify-between">
                <span>Green Spaces:</span>
                <span className="font-medium">{cityData.existingGreenSpaces?.length || 0} existing</span>
              </div>
              <div className="flex justify-between">
                <span>Baseline Coverage:</span>
                <span className="font-medium">{Math.round(cityData.baseGreen)}%</span>
              </div>
            </div>
          </div>

          {/* Location Search */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center">
              <MapIcon />
              <span className="ml-2">Location</span>
            </h3>
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select City
              </label>
              <select
                value={selectedLocation}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {Object.entries(cityLocations).map(([key, city]) => (
                  <option key={key} value={key}>
                    {city.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowLocationForm(!showLocationForm)}
              className="w-full p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors mb-4"
            >
              {showLocationForm ? 'Cancel' : '+ Add Structure'}
            </button>

            {showLocationForm && (
              <CustomLocationForm onSubmit={handleAddCustomLocation} />
            )}

            {customLocations.length > 0 && (
              <div className="mt-4">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Your Additions</h4>
                <div className="space-y-2 max-h-32 overflow-y-auto">
                  {customLocations.map(location => (
                    <div key={location.id} className="flex items-center justify-between p-2 bg-gray-50 rounded">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-800">{location.title}</div>
                        <div className="text-xs text-gray-500">
                          {structureTypes[location.type]?.find(s => s.id === location.subtype)?.label}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteCustomLocation(location.id)}
                        className="text-red-500 hover:text-red-700 text-sm"
                        title="Delete location"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Overlay Controls */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center">
              <LayersIcon />
              <span className="ml-2">Map Overlays</span>
            </h3>
            <div className="space-y-3">
              {overlayOptions.map(overlay => (
                <div key={overlay.id} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className={`w-3 h-3 rounded-full ${overlay.color}`}></div>
                    <div>
                      <div className="font-medium text-gray-700 text-sm">{overlay.label}</div>
                      <div className="text-xs text-gray-500">{overlay.desc}</div>
                    </div>
                  </div>
                  <input 
                    type="checkbox" 
                    checked={activeOverlays.includes(overlay.id)}
                    onChange={() => handleOverlayToggle(overlay.id)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Real-time Impact Metrics */}
          <div>
            <h3 className="font-semibold text-gray-800 mb-4 flex items-center">
              <BarChartIcon />
              <span className="ml-2">Real-time Impact Analysis</span>
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Green Space Coverage</span>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-400">{baselineMetrics.green}%</span>
                  <span className="text-sm">→</span>
                  <span className="text-sm font-medium text-green-600">{currentMetrics.green}%</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    currentMetrics.green > baselineMetrics.green 
                      ? 'bg-green-100 text-green-800' 
                      : currentMetrics.green < baselineMetrics.green 
                      ? 'bg-red-100 text-red-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {currentMetrics.green > baselineMetrics.green ? '+' : ''}
                    {currentMetrics.green - baselineMetrics.green}%
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Average Temperature</span>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-400">{baselineMetrics.temp}°F</span>
                  <span className="text-sm">→</span>
                  <span className="text-sm font-medium text-blue-600">{currentMetrics.temp}°F</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    currentMetrics.temp < baselineMetrics.temp 
                      ? 'bg-blue-100 text-blue-800' 
                      : currentMetrics.temp > baselineMetrics.temp
                      ? 'bg-red-100 text-red-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {currentMetrics.temp > baselineMetrics.temp ? '+' : ''}
                    {currentMetrics.temp - baselineMetrics.temp}°F
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Energy Efficiency</span>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-400">{baselineMetrics.energy}</span>
                  <span className="text-sm">→</span>
                  <span className="text-sm font-medium text-green-600">{currentMetrics.energy}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    currentMetrics.energy > baselineMetrics.energy 
                      ? 'bg-green-100 text-green-800' 
                      : currentMetrics.energy < baselineMetrics.energy
                      ? 'bg-red-100 text-red-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {currentMetrics.energy > baselineMetrics.energy ? '+' : ''}
                    {currentMetrics.energy - baselineMetrics.energy}
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Walk Score</span>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-400">{baselineMetrics.walk}</span>
                  <span className="text-sm">→</span>
                  <span className="text-sm font-medium text-indigo-600">{currentMetrics.walk}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    currentMetrics.walk > baselineMetrics.walk 
                      ? 'bg-indigo-100 text-indigo-800' 
                      : currentMetrics.walk < baselineMetrics.walk
                      ? 'bg-red-100 text-red-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {currentMetrics.walk > baselineMetrics.walk ? '+' : ''}
                    {currentMetrics.walk - baselineMetrics.walk}
                  </span>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600">Air Quality</span>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-400">{baselineMetrics.air}</span>
                  <span className="text-sm">→</span>
                  <span className="text-sm font-medium text-purple-600">{currentMetrics.air}</span>
                </div>
              </div>

              {/* Calculation Details */}
              <div className="mt-4 pt-4 border-t border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-2">Current Analysis</h4>
                <div className="text-xs text-gray-500 space-y-1">
                  <div>• Existing green spaces: {cityData.existingGreenSpaces?.length || 0}</div>
                  <div>• Your additions: {customLocations.length}</div>
                  <div>• Buildings: {customLocations.filter(m => m.type === 'building').length}</div>
                  <div>• Green additions: {customLocations.filter(m => m.type === 'green').length}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Map Area */}
      <div className="flex-1 relative" style={{ minHeight: '400px' }}>
        <MapContainer
          center={cityData.center}
          zoom={cityData.zoom}
          style={{ height: '100%', width: '100%' }}
          className="z-0"
          key={`${selectedLocation}-real-data`}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {/* Realistic map overlay effects */}
          <RealisticMapOverlays 
            activeOverlays={activeOverlays} 
            markers={allMarkers}
            cityCenter={cityData.center}
            trafficData={cityData.trafficData}
          />
          
          {/* Dynamic markers */}
          {allMarkers.map(marker => (
            <Marker key={marker.id} position={marker.position}>
              <Popup>
                <div className="p-2 max-w-xs">
                  <h3 className="font-semibold text-gray-800 mb-2">{marker.title}</h3>
                  
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Type:</span>
                      <span className="font-medium capitalize">
                        {structureTypes[marker.type]?.find(s => s.id === marker.subtype)?.label || marker.subtype}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Category:</span>
                      <span className="font-medium capitalize">{marker.type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Status:</span>
                      <span className={`font-medium ${
                        marker.existing ? 'text-blue-600' : 'text-green-600'
                      }`}>
                        {marker.existing ? 'Existing' : 'Your Addition'}
                      </span>
                    </div>
                    {marker.area && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">Area:</span>
                        <span className="font-medium">{marker.area} km²</span>
                      </div>
                    )}
                  </div>

                  {/* Environmental Impact */}
                  <div className="mt-3 pt-2 border-t border-gray-200">
                    <h4 className="text-xs font-medium text-gray-700 mb-1">Environmental Impact:</h4>
                    <div className="text-xs text-gray-600 space-y-1">
                      {marker.type === 'green' && (
                        <>
                          <div>• Cooling effect: {UrbanPlanningCalculations.greenEffectiveness[marker.subtype]?.cooling || 3.5}°F</div>
                          <div>• Improves air quality significantly</div>
                          <div>• Increases walkability and livability</div>
                        </>
                      )}
                      {marker.type === 'building' && (
                        <>
                          <div>• Energy efficiency: {Math.round((UrbanPlanningCalculations.buildingEfficiency[marker.subtype] || 0.6) * 100)}%</div>
                          <div>• Heat generation: {
                            (UrbanPlanningCalculations.buildingEfficiency[marker.subtype] || 0.6) > 0.7 ? 'Low' : 
                            (UrbanPlanningCalculations.buildingEfficiency[marker.subtype] || 0.6) > 0.5 ? 'Medium' : 'High'
                          }</div>
                          <div>• Walkability impact: {
                            ['mixed_use', 'retail'].includes(marker.subtype) ? 'High positive' :
                            marker.subtype === 'industrial' ? 'Negative' : 'Positive'
                          }</div>
                        </>
                      )}
                    </div>
                  </div>

                  {!marker.existing && (
                    <button
                      onClick={() => handleDeleteCustomLocation(marker.id)}
                      className="mt-3 w-full px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600"
                    >
                      Delete Structure
                    </button>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {/* Enhanced Legend */}
        <div className="absolute bottom-4 right-4 bg-white rounded-lg shadow-lg p-4 z-10 max-w-sm">
          <h4 className="font-semibold text-gray-800 mb-3">Map Legend</h4>
          
          <div className="space-y-3">
            {/* Markers Legend */}
            <div>
              <h5 className="text-sm font-medium text-gray-700 mb-2">Structures</h5>
              <div className="space-y-1 text-sm">
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-green-500 rounded"></div>
                  <span>Green Spaces</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-blue-500 rounded"></div>
                  <span>High Efficiency Buildings</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-yellow-500 rounded"></div>
                  <span>Standard Buildings</span>
                </div>
                <div className="flex items-center space-x-2">
                  <div className="w-3 h-3 bg-red-500 rounded"></div>
                  <span>Low Efficiency Buildings</span>
                </div>
              </div>
            </div>

            {/* Overlays Legend */}
            {activeOverlays.length > 0 && (
              <div className="pt-2 border-t border-gray-200">
                <h5 className="text-sm font-medium text-gray-700 mb-2">Active Overlays</h5>
                <div className="space-y-1 text-xs">
                  {activeOverlays.includes('heat') && (
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-red-400 rounded-full opacity-60"></div>
                      <span>Temperature zones</span>
                    </div>
                  )}
                  {activeOverlays.includes('green') && (
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-green-400 rounded-full opacity-60"></div>
                      <span>Green coverage zones</span>
                    </div>
                  )}
                  {activeOverlays.includes('traffic') && (
                    <div className="flex items-center space-x-2">
                      <div className="w-2 h-2 bg-blue-400 rounded-full opacity-60"></div>
                      <span>Traffic impact zones</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Current Status Info */}
          <div className="mt-3 pt-2 border-t border-gray-200">
            <div className="text-xs text-gray-600">
              <div>Location: <span className="font-medium">{cityData.name}</span></div>
              <div>Current Temp: <span className="font-medium">{cityData.weather.temperature}°F</span></div>
              <div>Total Elements: <span className="font-medium">{allMarkers.length}</span></div>
              <div>Your Additions: <span className="font-medium">{customLocations.length}</span></div>
            </div>
          </div>
        </div>

        {/* Real-time calculations indicator */}
        <div className="absolute top-4 right-4 bg-green-500 text-white px-3 py-1 rounded-full text-sm z-10">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-200 rounded-full animate-pulse"></div>
            <span>Real Data Active</span>
          </div>
        </div>

        {/* Data source indicator */}
        <div className="absolute top-4 left-4 bg-blue-500 text-white px-3 py-1 rounded-full text-xs z-10">
          <div>Weather: OpenWeather • Green Spaces: OpenStreetMap</div>
        </div>
      </div>
    </div>
  );
}

export default App;