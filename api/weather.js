// api/weather.js

export default async function handler(req, res) {
  // Set fixed location values
  const lat = "30.5773";
  const lon = "-97.8803";
  // Retrieve the API key from environment variables for security
  const apiKey = process.env.OPEN_WEATHER_MAP_API_KEY; 
  if (!apiKey) {
    return res.status(500).json({ error: "Missing API Key" });
  }
  
  // Build the API URL
  const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&exclude=minutely,daily,alerts&units=imperial&appid=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    // --- Scoring Functions ---
    function getTempScore(temp) {
      if (temp >= 75 && temp <= 85) return 5;
      else if ((temp >= 70 && temp < 75) || (temp > 85 && temp <= 90)) return 4;
      else if ((temp >= 65 && temp < 70) || (temp > 90 && temp <= 95)) return 3;
      else if ((temp >= 60 && temp < 65) || (temp > 95 && temp <= 100)) return 2;
      return 1;
    }
    function getWindScore(windBFT) {
      if (windBFT < 3) return 5;
      else if (windBFT === 3) return 3;
      else if (windBFT === 4) return 2;
      return 1;
    }
    function getOverallScore(temp, windBFT) {
      return Math.min(getTempScore(temp), getWindScore(windBFT));
    }
    function convertMphToBft(mph) {
      if (mph < 1) return 0;
      if (mph < 4) return 1;
      if (mph < 8) return 2;
      if (mph < 13) return 3;
      if (mph < 18) return 4;
      if (mph < 24) return 5;
      if (mph < 31) return 6;
      if (mph < 38) return 7;
      if (mph < 46) return 8;
      return Math.round(mph / 5);
    }

    // --- Process Current Conditions ---
    const currentFeelsLike = data.current.feels_like;
    const currentWindMph = data.current.wind_speed;
    const currentBft = convertMphToBft(currentWindMph);
    const currentOverallScore = getOverallScore(currentFeelsLike, currentBft);
    const currentWindScore = getWindScore(currentBft);
    const currentTempScore = getTempScore(currentFeelsLike);

    // --- Build Chart Data Arrays ---
    let overallData = [];
    let windData = [];
    let tempData = [];

    // Adjust current time using API's timezone_offset and set minutes to zero.
    let currentTime = new Date((data.current.dt + data.timezone_offset) * 1000);
    currentTime.setMinutes(0, 0, 0);
    const currentTimestamp = currentTime.getTime();
    overallData.push([currentTimestamp, currentOverallScore]);
    windData.push([currentTimestamp, currentWindScore]);
    tempData.push([currentTimestamp, currentTempScore]);

    // Process additional data points from the next few hours (here, 3 hours)
    const hoursToDisplay = 3;
    data.hourly.slice(1, hoursToDisplay + 1).forEach(hourData => {
      const timestamp = (hourData.dt + data.timezone_offset) * 1000;
      const feelsLike = hourData.feels_like;
      const windMph = hourData.wind_speed;
      const bft = convertMphToBft(windMph);
      const tempScore = getTempScore(feelsLike);
      const windScore = getWindScore(bft);
      const overallScore = getOverallScore(feelsLike, bft);
      overallData.push([timestamp, overallScore]);
      windData.push([timestamp, windScore]);
      tempData.push([timestamp, tempScore]);
    });

    // --- Determine Next Calm Period ---
    // Look for an 8-hour period (within the next 36 hours) where wind BFT < 3,
    // and where the start time is between 8am and 9pm local time.
    let calmStart = null;
    let calmCandidate = null;
    let calmCount = 0;
    const forecastLimit = Math.min(36, data.hourly.length);
    for (let i = 0; i < forecastLimit; i++) {
      const hourData = data.hourly[i];
      const bft = convertMphToBft(hourData.wind_speed);
      if (bft < 3) {
        if (calmCount === 0) {
          calmCandidate = hourData;
        }
        calmCount++;
        if (calmCount === 8) {
          const candidateTime = new Date((calmCandidate.dt + data.timezone_offset) * 1000);
          const candidateHour = candidateTime.getHours();
          if (candidateHour >= 8 && candidateHour < 21) {
            calmStart = calmCandidate.dt;
            break;
          } else {
            calmCount = 0;
            calmCandidate = null;
          }
        }
      } else {
        calmCount = 0;
        calmCandidate = null;
      }
    }
    // Helper: Format time in 12-hour format
    function formatTime(date) {
      let hours = date.getHours();
      const minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'pm' : 'am';
      hours = hours % 12;
      if (hours === 0) hours = 12;
      const minutesStr = minutes < 10 ? "0" + minutes : minutes;
      return `${hours}:${minutesStr}${ampm}`;
    }
    
    // New helper: Format time in Central Time (America/Chicago)
    function formatCentralTime(date) {
      return date.toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    }
    
    let calmPeriodText = "--";
    if (calmStart !== null) {
      const calmDate = new Date((calmStart + data.timezone_offset) * 1000);
      calmPeriodText = formatTime(calmDate);
    }

    // Updated "updatedAt" in Central Time using the new formatCentralTime helper
    const updatedAt = formatCentralTime(new Date());

    // --- Build the JSON Response ---
    const output = {
      current: {
        feels_like: Math.round(currentFeelsLike),
        wind_speed_mph: currentWindMph,
        wind_speed_bft: currentBft,
        overall_score: currentOverallScore,
        wind_score: currentWindScore,
        temp_score: currentTempScore,
        updated_at: updatedAt,
      },
      chart_data: {
        overall: overallData,
        wind: windData,
        temp: tempData,
      },
      calm_period: calmPeriodText
    };

    return res.status(200).json(output);
    
  } catch (error) {
    console.error("Error fetching weather data:", error);
    return res.status(500).json({ error: "Failed to fetch weather data" });
  }
}
