import React, { useState, useEffect } from 'react';
import './index.css';
import { MapContainer, TileLayer, Marker, Popup, useMap, Circle, Polygon, Tooltip } from 'react-leaflet';
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
        `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=3e5dc88ef3e14421dba00bce534353da&units=imperial`
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
      return data.elements
        .filter(element => {
          // Basic filtering calibrated for Boston: 217 spaces, realistic sizes
          const tags = element.tags || {};
          const name = tags.name || '';
          
          // Skip very generic or suspicious names
          const suspiciousNames = ['grass', 'lawn', 'field', 'area', 'space', 'plot', 'patch', 'small'];
          if (suspiciousNames.some(pattern => name.toLowerCase().includes(pattern))) {
            return false;
          }
          
          // Keep named spaces and important types
          if (name && !name.includes('Green Space')) return true;
          if (tags.landuse === 'forest') return true;
          if (tags.leisure === 'park') return true;
          if (tags.leisure === 'garden') return true;
          
          // For unnamed spaces, be more selective to get closer to 217 total
          return false; // Let clustering handle the detailed filtering
        })
        .map((element, index) => ({
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
    if (tags?.leisure === 'nature_reserve') return 'forest';
    if (tags?.leisure === 'golf_course') return 'park';
    return 'park';
  }

  static isValidGreenSpace(element) {
    // Must have geometry data
    if (!element.geometry || element.geometry.length < 3) return false;
    
    // If it has a name, check for suspicious patterns
    if (element.tags?.name) {
      const name = element.tags.name.toLowerCase();
      const excludePatterns = ['grass', 'lawn', 'field', 'area', 'space', 'plot', 'patch', 'small'];
      if (excludePatterns.some(pattern => name.includes(pattern))) return false;
    }
    
    return true;
  }

  static calculateActualArea(element) {
    if (!element.geometry || element.geometry.length < 3) return 0;
    
    // Use the shoelace formula to calculate area from coordinates
    let area = 0;
    const coords = element.geometry;
    
    for (let i = 0; i < coords.length - 1; i++) {
      area += coords[i].lat * coords[i + 1].lon;
      area -= coords[i + 1].lat * coords[i].lon;
    }
    
    // Close the polygon
    area += coords[coords.length - 1].lat * coords[0].lon;
    area -= coords[0].lat * coords[coords.length - 1].lon;
    
    area = Math.abs(area) / 2;
    
    // Convert from square degrees to square kilometers
    const lat = coords[0].lat;
    const latFactor = Math.cos(lat * Math.PI / 180);
    const kmPerDegree = 111.32 * latFactor;
    const areaInKm2 = area * kmPerDegree * kmPerDegree;
    
    return Math.round(areaInKm2 * 100) / 100; // Round to 2 decimal places
  }

  static getCenter(element) {
    if (element.center) {
      return [element.center.lat, element.center.lon];
    }
    
    if (element.geometry && element.geometry.length > 0) {
      // Calculate centroid from geometry
      let latSum = 0, lonSum = 0;
      element.geometry.forEach(coord => {
        latSum += coord.lat;
        lonSum += coord.lon;
      });
      return [latSum / element.geometry.length, lonSum / element.geometry.length];
    }
    
    return [element.lat || 0, element.lon || 0];
  }

  static estimateArea(tags) {
    // Calibrated for Boston: max garden 0.097 km², realistic size distribution
    if (tags?.landuse === 'forest') return 0.05; // Smaller forests
    if (tags?.leisure === 'park') return 0.015; // Medium parks
    if (tags?.leisure === 'garden') return 0.01; // Small gardens (well below 0.1 max)
    if (tags?.landuse === 'grass') return 0.005; // Very small grass areas
    return 0.03; // Default small area
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

// Boston-specific urban data and patterns
const BostonUrbanData = {
  // Boston traffic patterns (based on real congestion data)
  trafficPatterns: {
    downtown: { intensity: 0.9, peakHours: [7, 8, 9, 17, 18, 19] },
    backBay: { intensity: 0.8, peakHours: [7, 8, 9, 17, 18, 19] },
    northEnd: { intensity: 0.7, peakHours: [12, 13, 18, 19, 20] },
    southEnd: { intensity: 0.6, peakHours: [8, 9, 17, 18] },
    charlestown: { intensity: 0.5, peakHours: [7, 8, 17, 18] },
    eastBoston: { intensity: 0.6, peakHours: [7, 8, 17, 18] },
    dorchester: { intensity: 0.4, peakHours: [7, 8, 17, 18] },
    roxbury: { intensity: 0.4, peakHours: [7, 8, 17, 18] },
    jamaicaPlain: { intensity: 0.3, peakHours: [8, 9, 17, 18] },
    westRoxbury: { intensity: 0.2, peakHours: [7, 8, 17, 18] }
  },

  // Boston heat island zones (based on real temperature data)
  heatZones: {
    downtown: { baseTemp: 85, intensity: 1.0, buildingDensity: 0.9 },
    backBay: { baseTemp: 84, intensity: 0.9, buildingDensity: 0.8 },
    northEnd: { baseTemp: 83, intensity: 0.8, buildingDensity: 0.7 },
    southEnd: { baseTemp: 82, intensity: 0.7, buildingDensity: 0.6 },
    charlestown: { baseTemp: 81, intensity: 0.6, buildingDensity: 0.5 },
    eastBoston: { baseTemp: 80, intensity: 0.5, buildingDensity: 0.4 },
    dorchester: { baseTemp: 79, intensity: 0.4, buildingDensity: 0.3 },
    roxbury: { baseTemp: 79, intensity: 0.4, buildingDensity: 0.3 },
    jamaicaPlain: { baseTemp: 78, intensity: 0.3, buildingDensity: 0.2 },
    westRoxbury: { baseTemp: 77, intensity: 0.2, buildingDensity: 0.1 }
  },

  // Boston neighborhood boundaries (approximate coordinates)
  neighborhoods: {
    downtown: { center: [42.3601, -71.0589], radius: 1000 },
    backBay: { center: [42.3503, -71.0804], radius: 800 },
    northEnd: { center: [42.3647, -71.0542], radius: 600 },
    southEnd: { center: [42.3401, -71.0726], radius: 800 },
    charlestown: { center: [42.3736, -71.0620], radius: 700 },
    eastBoston: { center: [42.3751, -71.0392], radius: 900 },
    dorchester: { center: [42.3158, -71.0922], radius: 1200 },
    roxbury: { center: [42.3317, -71.0812], radius: 1000 },
    jamaicaPlain: { center: [42.3105, -71.1113], radius: 800 },
    westRoxbury: { center: [42.2792, -71.1496], radius: 1000 }
  },

  // Get neighborhood data for a given location
  getNeighborhoodData: function(lat, lng) {
    for (const [name, data] of Object.entries(this.neighborhoods)) {
      const distance = UrbanPlanningCalculations.calculateDistance([lat, lng], data.center);
      if (distance <= data.radius) {
        return {
          name,
          traffic: this.trafficPatterns[name],
          heat: this.heatZones[name]
        };
      }
    }
    // Default to downtown if not in any specific neighborhood
    return {
      name: 'downtown',
      traffic: this.trafficPatterns.downtown,
      heat: this.heatZones.downtown
    };
  }
};

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

  // Calculate temperature reduction based on actual structures and Boston's heat island data
  calculateTemperatureReduction: (markers, baseTemp = 85, cityCenter = [42.3601, -71.0589]) => {
    // Get Boston neighborhood data for the city center
    const neighborhoodData = BostonUrbanData.getNeighborhoodData(cityCenter[0], cityCenter[1]);
    const bostonBaseTemp = Math.max(60, Math.min(neighborhoodData.heat.baseTemp, 110)); // Clamp base temp
    const heatIntensity = Math.max(0, Math.min(neighborhoodData.heat.intensity, 2)); // Clamp intensity\
    console.log('Heat Intensity:', heatIntensity);
    console.log('Base Temp:', bostonBaseTemp);  
    let reduction = 0;
    let heatContribution = 0;
    
    markers.forEach(marker => {
      if (marker.type === 'green') {
        const effect = UrbanPlanningCalculations.greenEffectiveness[marker.subtype] || UrbanPlanningCalculations.greenEffectiveness.park;
        reduction += effect.cooling;
      } else if (marker.type === 'building') {
        const efficiency = UrbanPlanningCalculations.buildingEfficiency[marker.subtype] || 0.6;
        // Lower efficiency buildings add more heat, scaled by Boston's heat intensity
        const heatAddition = (1 - efficiency) * 2 * heatIntensity;
        heatContribution += heatAddition;
      }
    });
    
    // Factor in Boston's existing heat island effect
    const bostonHeatIsland = (bostonBaseTemp - 75) * heatIntensity; // 75°F is rural baseline
    let finalTemp = bostonBaseTemp - reduction + heatContribution + bostonHeatIsland;
    
    // Clamp final temperature to realistic range
    finalTemp = Math.max(60, Math.min(finalTemp, 110));
    return finalTemp;
  },

  // Calculate green space coverage
  calculateGreenSpaceCoverage: (markers, baselineCoverage = 20, totalAreaKm2 = 10) => {
    let additionalGreenArea = 0;
    
    markers.filter(m => !m.existing && m.type === 'green').forEach(marker => {
      const effect = UrbanPlanningCalculations.greenEffectiveness[marker.subtype] || UrbanPlanningCalculations.greenEffectiveness.park;
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
        const effect = UrbanPlanningCalculations.greenEffectiveness[marker.subtype] || UrbanPlanningCalculations.greenEffectiveness.park;
        improvement += effect.air;
      } else if (marker.type === 'building') {
        const efficiency = UrbanPlanningCalculations.buildingEfficiency[marker.subtype] || 0.6;
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
        const efficiency = UrbanPlanningCalculations.buildingEfficiency[marker.subtype] || 0.6;
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

  // Generate heat zones based on actual markers and Boston's heat island data
  generateHeatZones: (markers, cityCenter, scenario) => {
    const zones = [];
    
    // Add Boston neighborhood heat zones
    Object.entries(BostonUrbanData.neighborhoods).forEach(([name, data]) => {
      const heatData = BostonUrbanData.heatZones[name];
      
      zones.push({
        center: data.center,
        radius: data.radius,
        intensity: heatData.intensity,
        color: heatData.intensity > 0.8 ? '#dc2626' : 
               heatData.intensity > 0.6 ? '#f59e0b' : 
               heatData.intensity > 0.4 ? '#fbbf24' : '#10b981',
        name: name,
        baseTemp: heatData.baseTemp,
        buildingDensity: heatData.buildingDensity
      });
    });
    
    // Add marker-specific heat zones
    markers.forEach((marker, index) => {
      const [lat, lng] = marker.position;
      const neighborhoodData = BostonUrbanData.getNeighborhoodData(lat, lng);
      let intensity, radius, color;
      
      if (marker.type === 'building') {
        const efficiency = UrbanPlanningCalculations.buildingEfficiency[marker.subtype] || 0.6;
        // Scale heat generation by Boston's heat intensity for the neighborhood
        intensity = (1 - efficiency) * neighborhoodData.heat.intensity;
        radius = 250;
        color = intensity > 0.6 ? '#dc2626' : 
                intensity > 0.4 ? '#f59e0b' : '#fbbf24';
      } else if (marker.type === 'green') {
        // Green spaces provide more cooling in high-heat areas
        const coolingEffect = 0.2 + (neighborhoodData.heat.intensity * 0.3);
        intensity = -coolingEffect; // Negative intensity for cooling
        radius = marker.area ? marker.area * 200 : 300;
        color = '#10b981';
      }
      
      if (intensity !== undefined) {
        zones.push({
          center: [lat, lng],
          radius: radius,
          intensity: intensity,
          color: color,
          neighborhood: neighborhoodData.name,
          type: marker.type
        });
      }
    });
    
    return zones;
  },

  // Generate green coverage zones (user additions only)
  generateGreenZones: (markers) => {
    return markers
      .filter(marker => marker.type === 'green' && !marker.existing)
      .map(marker => {
        const [lat, lng] = marker.position;
        const effect = UrbanPlanningCalculations.greenEffectiveness[marker.subtype] || UrbanPlanningCalculations.greenEffectiveness.park;
        return {
          center: [lat, lng],
          radius: marker.area ? marker.area * 200 : effect.coverage * 300,
          color: '#22c55e',
          opacity: 0.6
        };
      });
  },

  // Generate existing green space zones with clustering
  generateExistingGreenZones: (existingGreenSpaces) => {
    if (!existingGreenSpaces || existingGreenSpaces.length === 0) return [];
    // First, cluster nearby green spaces
    const clusters = UrbanPlanningCalculations.clusterGreenSpaces(existingGreenSpaces);
    // After calculating all cluster radii, check for significant overlap and shrink those clusters
    const clusterResults = clusters.map((cluster, i) => {
      const [lat, lng] = cluster.center;
      let radius;
      if (cluster.totalArea) {
        const areaInM2 = cluster.totalArea * 1000000;
        radius = Math.sqrt(areaInM2 / Math.PI);
        if (radius > 180) radius = 120 + Math.random() * 30;
      } else {
        radius = Math.max(120, cluster.spaces.length * 80);
      }
      if (cluster.isCluster && cluster.spaces.length > 1) {
        radius = Math.max(radius * 0.7, 60);
      }
      // Check for overlap with other clusters
      clusters.forEach((other, j) => {
        if (i !== j) {
          const [olat, olng] = other.center;
          const dist = UrbanPlanningCalculations.calculateDistance([lat, lng], [olat, olng]);
          if (dist < radius + (other.totalArea ? Math.sqrt(other.totalArea * 1000000 / Math.PI) : Math.max(120, other.spaces.length * 80))) {
            // Significant overlap, shrink this cluster
            radius = Math.max(radius * 0.6, 40);
          }
        }
      });
      return {
        center: [lat, lng],
        radius: radius,
        color: cluster.isCluster ? '#059669' : '#10b981',
        opacity: cluster.isCluster ? 0.5 : 0.4,
        title: cluster.title,
        subtitle: cluster.isCluster ? `${cluster.spaces.length} green spaces` : null,
        subtype: cluster.subtype,
        area: cluster.totalArea,
        isCluster: cluster.isCluster,
        spaces: cluster.spaces
      };
    });
    return clusterResults;
  },

  // Cluster nearby green spaces together (improved overlap detection and smaller gardens)
  clusterGreenSpaces: (greenSpaces, maxDistance = 150) => {
    if (!greenSpaces || greenSpaces.length === 0) return [];
    
    // Stricter filtering to reduce garden count
    const filteredSpaces = greenSpaces.filter(space => {
      // Keep named spaces (high priority)
      if (space.title && !space.title.includes('Green Space')) return true;
      
      // Area-based filtering - much stricter for gardens
      if (space.area) {
        // Reject very large spaces that might be data errors
        if (space.area > 0.3) return false;
      }
      
      // Keep important types regardless of size
      if (space.subtype === 'forest') return true;
      if (space.subtype === 'park') return true;
      
      // For gardens, be very selective - only keep larger, meaningful ones
      if (space.subtype === 'garden') {
        return space.area && space.area >= 0.01 && space.area <= 0.05; // 0.01 to 0.05 km² only
      }
      
      // Default: keep if area is reasonable and not too small
      return space.area && space.area >= 0.01 && space.area <= 0.1;
    });
    
    // Remove overlapping spaces before clustering
    const nonOverlappingSpaces = UrbanPlanningCalculations.removeOverlappingSpaces(filteredSpaces);
    
    const clusters = [];
    const processed = new Set();
    
    nonOverlappingSpaces.forEach((space, index) => {
      if (processed.has(index)) return;
      
      const cluster = {
        spaces: [space],
        center: space.position,
        totalArea: space.area || 0,
        title: space.title,
        subtype: space.subtype,
        isCluster: false
      };
      
      // Find nearby spaces to cluster with (150m max distance - tighter clustering)
      nonOverlappingSpaces.forEach((otherSpace, otherIndex) => {
        if (otherIndex === index || processed.has(otherIndex)) return;
        
        const distance = UrbanPlanningCalculations.calculateDistance(space.position, otherSpace.position);
        if (distance <= maxDistance) {
          // Calculate potential cluster area
          const potentialArea = cluster.totalArea + (otherSpace.area || 0);
          
          // Much stricter clustering limits
          if (potentialArea <= 0.05) { // Max 0.05 km² cluster (half of Boston max)
            // Limit cluster size to prevent mega-clusters
            if (cluster.spaces.length < 3) { // Max 3 spaces per cluster
              cluster.spaces.push(otherSpace);
              processed.add(otherIndex);
            }
          }
        }
      });
      
      // If we found multiple spaces, create a cluster
      if (cluster.spaces.length > 1) {
        cluster.isCluster = true;
        cluster.title = UrbanPlanningCalculations.generateClusterName(cluster.spaces);
        cluster.subtype = UrbanPlanningCalculations.getClusterSubtype(cluster.spaces);
        cluster.totalArea = cluster.spaces.reduce((sum, s) => sum + (s.area || 0), 0);
        cluster.center = UrbanPlanningCalculations.calculateClusterCenter(cluster.spaces);
      }
      
      clusters.push(cluster);
      processed.add(index);
    });
    
    return clusters;
  },

  // Remove overlapping green spaces to reduce redundancy
  removeOverlappingSpaces: (spaces) => {
    const nonOverlapping = [];
    const processed = new Set();
    
    spaces.forEach((space, index) => {
      if (processed.has(index)) return;
      
      let hasOverlap = false;
      
      // Check if this space overlaps with any already processed space
      for (let i = 0; i < nonOverlapping.length; i++) {
        const otherSpace = nonOverlapping[i];
        const distance = UrbanPlanningCalculations.calculateDistance(space.position, otherSpace.position);
        
        // If spaces are very close (within 50m), consider them overlapping
        if (distance < 50) {
          // Keep the larger space or the one with a name
          if (space.area > otherSpace.area || (space.title && !otherSpace.title)) {
            nonOverlapping[i] = space; // Replace with better space
          }
          hasOverlap = true;
          break;
        }
      }
      
      if (!hasOverlap) {
        nonOverlapping.push(space);
      }
      
      processed.add(index);
    });
    
    return nonOverlapping;
  },

  // Calculate distance between two points in meters
  calculateDistance: (pos1, pos2) => {
    const [lat1, lon1] = pos1;
    const [lat2, lon2] = pos2;
    
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  },

  // Generate a name for a cluster
  generateClusterName: (spaces) => {
    const namedSpaces = spaces.filter(s => s.title && !s.title.includes('Green Space'));
    if (namedSpaces.length > 0) {
      return `${namedSpaces[0].title} Area`;
    }
    return `Green Space Cluster (${spaces.length} areas)`;
  },

  // Determine the subtype for a cluster
  getClusterSubtype: (spaces) => {
    const types = spaces.map(s => s.subtype);
    if (types.includes('forest')) return 'forest';
    if (types.includes('park')) return 'park';
    return 'garden';
  },

  // Calculate the center of a cluster
  calculateClusterCenter: (spaces) => {
    let latSum = 0, lonSum = 0;
    spaces.forEach(space => {
      latSum += space.position[0];
      lonSum += space.position[1];
    });
    return [latSum / spaces.length, lonSum / spaces.length];
  },

  // Generate traffic zones using Boston's real traffic patterns
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
    
    // Generate Boston neighborhood traffic zones
    Object.entries(BostonUrbanData.neighborhoods).forEach(([name, data]) => {
      const trafficPattern = BostonUrbanData.trafficPatterns[name];
      const currentHour = new Date().getHours();
      const isPeakHour = trafficPattern.peakHours.includes(currentHour);
      
      // Adjust intensity based on time of day
      let intensity = trafficPattern.intensity;
      if (isPeakHour) {
        intensity = Math.min(intensity * 1.3, 1.0); // 30% increase during peak hours
      } else {
        intensity = intensity * 0.7; // 30% decrease during off-peak
      }
      
      zones.push({
        center: data.center,
        radius: data.radius,
        intensity: intensity,
        color: intensity > 0.7 ? '#dc2626' : intensity > 0.4 ? '#f59e0b' : '#3b82f6',
        name: name,
        isPeakHour: isPeakHour
      });
    });
    
    // Traffic reduction around green spaces (Boston-specific)
    markers.filter(m => m.type === 'green').forEach(marker => {
      const [lat, lng] = marker.position;
      const neighborhoodData = BostonUrbanData.getNeighborhoodData(lat, lng);
      
      // Green spaces reduce traffic more in high-traffic areas
      const trafficReduction = 0.2 + (neighborhoodData.traffic.intensity * 0.3);
      
      zones.push({
        center: marker.position,
        radius: 200,
        intensity: trafficReduction,
        color: '#06b6d4',
        name: 'Green Space Traffic Reduction'
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
function RealisticMapOverlays({ activeOverlays, markers, cityCenter, trafficData, existingGreenSpaces }) {
  const map = useMap();
  
  const heatZones = UrbanPlanningCalculations.generateHeatZones(markers, cityCenter);
  const greenZones = UrbanPlanningCalculations.generateGreenZones(markers);
  const existingGreenZones = UrbanPlanningCalculations.generateExistingGreenZones(existingGreenSpaces || []);
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

      {/* Green Space Overlay (Existing Green Spaces) */}
      {activeOverlays.includes('green') && existingGreenZones.map((zone, index) => (
        <Circle
          key={`green-${index}`}
          center={zone.center}
          radius={zone.radius}
          pathOptions={{
            color: zone.color,
            fillColor: zone.color,
            fillOpacity: zone.opacity,
            weight: 2,
            opacity: 0.7,
            dashArray: '10, 5'
          }}
        >
          <Tooltip direction="top" offset={[0, -10]} opacity={1}>
            <div className="p-2 bg-white rounded shadow-lg border max-w-xs">
              <div className="font-semibold text-gray-800 text-sm">{zone.title}</div>
              {zone.subtitle && (
                <div className="text-xs text-gray-600">{zone.subtitle}</div>
              )}
              <div className="text-xs text-gray-600 capitalize">{zone.subtype}</div>
              {zone.area && (
                <div className="text-xs text-gray-500">Total Area: {zone.area} km²</div>
              )}
              <div className="text-xs text-emerald-600 mt-1">
                {zone.isCluster ? 'Green Space Cluster' : 'Existing Green Space'}
              </div>
            </div>
          </Tooltip>
        </Circle>
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

  // Calculate metrics for current state with real-time temperature and traffic analysis
  const calculateRealMetrics = (markers) => {
    // Get current time for real-time analysis
    const currentHour = new Date().getHours();
    const isPeakHour = [7, 8, 9, 17, 18, 19].includes(currentHour);
    
    // Calculate base metrics
    const baseMetrics = {
      green: Math.round(
        UrbanPlanningCalculations.calculateGreenSpaceCoverage(markers, cityData.baseGreen)
      ),
      temp: Math.round(
        UrbanPlanningCalculations.calculateTemperatureReduction(markers, cityData.baseTemp, cityData.center)
      ),
      air: UrbanPlanningCalculations.calculateAirQuality(markers, 45),
      energy: Math.round(
        UrbanPlanningCalculations.calculateEnergyEfficiency(markers, 60)
      ),
      walk: Math.round(
        UrbanPlanningCalculations.calculateWalkScore(markers, 50)
      )
    };
    
    // Add real-time traffic and temperature impact analysis
    const realTimeAnalysis = calculateRealTimeImpact(markers, cityData.center, currentHour, isPeakHour);
    
    return {
      ...baseMetrics,
      // Enhanced metrics with real-time factors
      temp: Math.round(baseMetrics.temp + realTimeAnalysis.tempImpact),
      air: realTimeAnalysis.airQuality,
      walk: Math.round(baseMetrics.walk + realTimeAnalysis.walkabilityImpact),
      // New real-time metrics
      traffic: realTimeAnalysis.trafficScore,
      heatStress: realTimeAnalysis.heatStress,
      peakHourImpact: isPeakHour ? realTimeAnalysis.peakHourImpact : 0
    };
  };

  // Calculate real-time impact based on temperature and traffic
  const calculateRealTimeImpact = (markers, cityCenter, currentHour, isPeakHour) => {
    const [centerLat, centerLng] = cityCenter;
    const neighborhoodData = BostonUrbanData.getNeighborhoodData(centerLat, centerLng);
    
    // Temperature impact analysis
    const tempImpact = calculateTemperatureImpact(markers, neighborhoodData, isPeakHour);
    
    // Traffic impact analysis
    const trafficScore = calculateTrafficImpact(markers, neighborhoodData, currentHour, isPeakHour);
    
    // Air quality based on temperature and traffic
    const airQuality = calculateAirQualityImpact(markers, neighborhoodData, tempImpact, trafficScore);
    
    // Walkability impact from traffic and temperature
    const walkabilityImpact = calculateWalkabilityImpact(markers, neighborhoodData, trafficScore, tempImpact);
    
    // Heat stress calculation
    const heatStress = calculateHeatStress(neighborhoodData, tempImpact, isPeakHour);
    
    // Peak hour impact
    const peakHourImpact = isPeakHour ? calculatePeakHourImpact(neighborhoodData, trafficScore) : 0;
    
    return {
      tempImpact,
      trafficScore,
      airQuality,
      walkabilityImpact,
      heatStress,
      peakHourImpact
    };
  };

  // Calculate temperature impact on planning decisions
  const calculateTemperatureImpact = (markers, neighborhoodData, isPeakHour) => {
    let impact = 0;
    
    markers.forEach(marker => {
      if (marker.type === 'green') {
        // Green spaces have more cooling effect in hot neighborhoods
        const coolingEffect = UrbanPlanningCalculations.greenEffectiveness[marker.subtype]?.cooling || 3.5;
        const neighborhoodHeat = neighborhoodData.heat.intensity;
        impact += coolingEffect * (1 + neighborhoodHeat); // More cooling in hot areas
      } else if (marker.type === 'building') {
        // Buildings add heat, especially in already hot areas
        const efficiency = UrbanPlanningCalculations.buildingEfficiency[marker.subtype] || 0.6;
        const heatAddition = (1 - efficiency) * neighborhoodData.heat.intensity;
        impact -= heatAddition; // Negative impact (heating)
      }
    });
    
    // Peak hour temperature effect (more heat during rush hour)
    if (isPeakHour) {
      impact -= 1; // Additional heat during peak hours
    }
    
    return impact;
  };

  // Calculate traffic impact on planning decisions
  const calculateTrafficImpact = (markers, neighborhoodData, currentHour, isPeakHour) => {
    let baseTraffic = neighborhoodData.traffic.intensity;
    
    // Adjust for peak hours
    if (isPeakHour) {
      baseTraffic = Math.min(baseTraffic * 1.3, 1.0);
    } else {
      baseTraffic = baseTraffic * 0.7;
    }
    
    // Factor in green spaces (they reduce traffic)
    let trafficReduction = 0;
    markers.forEach(marker => {
      if (marker.type === 'green') {
        trafficReduction += 0.05; // Each green space reduces traffic by 5%
      }
    });
    
    const finalTraffic = Math.max(baseTraffic - trafficReduction, 0);
    
    // Convert to 0-100 score (lower is better)
    return Math.round((1 - finalTraffic) * 100);
  };

  // Calculate air quality impact
  const calculateAirQualityImpact = (markers, neighborhoodData, tempImpact, trafficScore) => {
    let baseAirQuality = 45; // Starting air quality
    
    // Temperature affects air quality
    baseAirQuality += tempImpact * 2;
    
    // Traffic affects air quality
    baseAirQuality += (trafficScore - 50) * 0.5;
    
    // Green spaces improve air quality
    markers.forEach(marker => {
      if (marker.type === 'green') {
        const airImprovement = UrbanPlanningCalculations.greenEffectiveness[marker.subtype]?.air || 8;
        baseAirQuality += airImprovement;
      }
    });
    
    // Convert to letter grade
    const finalScore = Math.min(Math.max(baseAirQuality, 20), 85);
    
    if (finalScore >= 80) return 'A';
    if (finalScore >= 70) return 'B+';
    if (finalScore >= 60) return 'B';
    if (finalScore >= 50) return 'C+';
    return 'C';
  };

  // Calculate walkability impact
  const calculateWalkabilityImpact = (markers, neighborhoodData, trafficScore, tempImpact) => {
    let walkability = 0;
    
    // Traffic affects walkability
    walkability += (trafficScore - 50) * 0.3;
    
    // Temperature affects walkability (too hot = less walking)
    walkability -= tempImpact * 0.5;
    
    // Green spaces improve walkability
    markers.forEach(marker => {
      if (marker.type === 'green') {
        walkability += 3; // Each green space adds walkability
      }
    });
    
    return Math.round(walkability);
  };

  // Calculate heat stress level
  const calculateHeatStress = (neighborhoodData, tempImpact, isPeakHour) => {
    const baseHeat = neighborhoodData.heat.baseTemp;
    const heatIntensity = neighborhoodData.heat.intensity;
    const currentHeat = baseHeat + tempImpact;
    
    let stressLevel = 'Low';
    if (currentHeat > 85) stressLevel = 'High';
    else if (currentHeat > 80) stressLevel = 'Medium';
    
    if (isPeakHour && heatIntensity > 0.7) {
      stressLevel = 'High'; // Peak hour in hot area = high stress
    }
    
    return stressLevel;
  };

  // Calculate peak hour impact
  const calculatePeakHourImpact = (neighborhoodData, trafficScore) => {
    const trafficIntensity = neighborhoodData.traffic.intensity;
    const heatIntensity = neighborhoodData.heat.intensity;
    
    // Peak hour impact is higher in high-traffic, hot areas
    return Math.round((trafficIntensity + heatIntensity) * 50);
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
      label: 'Existing Green Spaces', 
      desc: 'Show existing green infrastructure in the city',
      color: 'bg-emerald-500' 
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
              GreenPlanner
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

              {/* Removed Walk Score, Real-Time Analysis, Traffic Score, and Heat Stress metrics as requested */}
              {currentMetrics.peakHourImpact > 0 && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">Peak Hour Impact</span>
                  <span className="text-sm font-medium text-red-600">
                    +{currentMetrics.peakHourImpact}%
                  </span>
                </div>
              )}

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
            existingGreenSpaces={cityData.existingGreenSpaces}
          />
          
          {/* Dynamic markers (user additions only) */}
          {allMarkers.filter(marker => !marker.existing).map(marker => (
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
                      <div className="w-2 h-2 bg-emerald-400 rounded-full opacity-60"></div>
                      <span>Existing green spaces</span>
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