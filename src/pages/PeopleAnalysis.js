import React, { useState, useRef } from 'react';
import { Card, Button } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import * as faceapi from '@vladmandic/face-api';
import supabase from '../components/database'; // Import Supabase client

const PeopleAnalysis = () => {
  const [showCamera, setShowCamera] = useState(false);
  const [maleCount, setMaleCount] = useState(0);
  const [femaleCount, setFemaleCount] = useState(0);
  const [finalMaleCount, setFinalMaleCount] = useState(0);
  const [finalFemaleCount, setFinalFemaleCount] = useState(0);
  const [mood, setMood] = useState('Neutral');
  const [finalMood, setFinalMood] = useState('UNKNOWN');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const [isPersonDetected, setIsPersonDetected] = useState(false);
  const [collectedData, setCollectedData] = useState([]);
  const [summaryVisible, setSummaryVisible] = useState(false); // Track if summary is visible

  const handleStartCamera = async () => {
    try {
      setShowCamera(true);
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      mediaStreamRef.current = stream;
      videoRef.current.srcObject = stream;

      videoRef.current.onloadedmetadata = async () => {
        videoRef.current.play();
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;

        try {
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
            faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
            faceapi.nets.ageGenderNet.loadFromUri('/models'),
            faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
            faceapi.nets.faceExpressionNet.loadFromUri('/models'),
          ]);
          detectFaces();
        } catch (error) {
          console.error('Error loading models:', error);
        }
      };

      // Reset summary when starting the camera
      setSummaryVisible(false);
    } catch (error) {
      console.error('Error starting camera:', error);
    }
  };

  const handleStopCamera = async () => {
    const stream = mediaStreamRef.current;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    setShowCamera(false);
    setIsPersonDetected(false);

    // Save final counts and mood before stopping
    const totalMale = maleCount;
    const totalFemale = femaleCount;

    console.log(`Stopping camera: Total Male: ${totalMale}, Total Female: ${totalFemale}, Mood: ${mood}`);

    // Send collected data to Supabase
    if (collectedData.length > 0) {
      await saveDataToSupabase(totalMale, totalFemale);
    }

    // Update the final counts and mood
    setFinalMaleCount(totalMale);
    setFinalFemaleCount(totalFemale);
    setFinalMood(mood);
    setSummaryVisible(true); // Show the summary after stopping the camera
  };

  const detectFaces = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    const detect = async () => {
      if (video && canvas && video.videoWidth > 0 && video.videoHeight > 0) {
        const detections = await faceapi
          .detectAllFaces(video, new faceapi.TinyFaceDetectorOptions())
          .withFaceLandmarks()
          .withAgeAndGender()
          .withFaceExpressions();

        drawBoxes(canvas.getContext('2d'), video, detections);
      }
      requestAnimationFrame(detect);
    };

    detect();
  };

  const drawBoxes = (context, video, detections) => {
    if (!context || !canvasRef.current) return;

    context.clearRect(0, 0, video.videoWidth, video.videoHeight);
    context.strokeStyle = 'red';
    context.lineWidth = 2;

    const scaleX = canvasRef.current.width / video.videoWidth;
    const scaleY = canvasRef.current.height / video.videoHeight;

    let maleCountThisFrame = 0;
    let femaleCountThisFrame = 0;
    let detectedThisFrame = false;
    let newMood = 'UNKNOWN';

    detections.forEach(detection => {
      const { x, y, width, height } = detection.detection.box;
      context.strokeRect(x * scaleX, y * scaleY, width * scaleX, height * scaleY);

      const age = Math.round(detection.age);
      const gender = detection.gender === 'male' ? 'MALE' : 'FEMALE';
      const expressions = detection.expressions;

      if (expressions) {
        newMood = Object.keys(expressions).reduce((a, b) =>
          expressions[a] > expressions[b] ? a : b
        ).toUpperCase();
      }

      detectedThisFrame = true;
      setIsPersonDetected(true); // Update the detection state

      // Count male and female faces
      if (gender === 'MALE') {
        maleCountThisFrame++;
      } else if (gender === 'FEMALE') {
        femaleCountThisFrame++;
      }

      // Collect data
      setCollectedData(prevData => [
        ...prevData,
        {
          age: age,
          gender: gender,
          emotion: newMood,
          timestamp: new Date().toISOString(),
        },
      ]);

      const boxWidth = 250;
      const boxHeight = 100;
      const boxX = x * scaleX + width * scaleX + 10;
      const boxY = y * scaleY;

      context.fillStyle = 'rgba(255, 255, 255, 0.7)';
      context.fillRect(boxX, boxY, boxWidth, boxHeight);

      context.fillStyle = 'black';
      context.font = '16px Arial';
      context.fillText(`AGE: ${age}`, boxX + 5, boxY + 20);
      context.fillText(`GENDER: ${gender}`, boxX + 5, boxY + 40);
      context.fillText(`EMOTION: ${newMood}`, boxX + 5, boxY + 60);
    });

    setMaleCount(maleCountThisFrame);
    setFemaleCount(femaleCountThisFrame);
    setMood(newMood);

    if (!detectedThisFrame) {
      if (isPersonDetected) {
        setIsPersonDetected(false);
        setMood('UNKNOWN');
      }
    }
  };

  const saveDataToSupabase = async (totalMale, totalFemale) => {
    const currentDate = new Date();
    
    // Use Intl.DateTimeFormat for better control over date formatting
    const date = currentDate.toLocaleDateString('en-CA'); // Format as YYYY-MM-DD
    const time = currentDate.toLocaleTimeString('en-GB', { hour12: false }); // Format as HH:MM:SS
  
    try {
      const { data, error } = await supabase.from('analysis').insert([
        {
          Date: date,
          "Total male": totalMale,
          "Total Female": totalFemale,
          Time: time,
        },
      ]);
  
      if (error) {
        console.error('Error inserting data into Supabase:', error.message);
      } else {
        console.log('Data inserted successfully:', data);
      }
    } catch (error) {
      console.error('Error saving data to Supabase:', error);
    }
  };
  
  return (
    <div className="camera-container d-flex flex-column align-items-center" style={{ minHeight: '100vh' }}>
      <h2 className="mb-4">Webcam People Analysis</h2>
      <Card className="shadow" style={{ width: '100%', maxWidth: '600px' }}>
        <Card.Body>
          {showCamera ? (
            <Button variant="danger" onClick={handleStopCamera}>
              Stop Camera
            </Button>
          ) : (
            <Button variant="primary" onClick={handleStartCamera}>
              Start Camera
            </Button>
          )}
        </Card.Body>
      </Card>

      {showCamera && (
        <div className="video-stream mt-4" style={{ position: 'relative' }}>
          <Card className="shadow">
            <Card.Body>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', maxHeight: '400px', objectFit: 'cover' }}
              />
              <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0 }} />
            </Card.Body>
          </Card>
        </div>
      )}

      {/* Display summary if visible */}
      {summaryVisible && (
        <Card className="mt-4">
          <Card.Body>
            <h5>Summary</h5>
            <p>Total Male: {finalMaleCount}</p>
            <p>Total Female: {finalFemaleCount}</p>
           
          </Card.Body>
        </Card>
      )}
    </div>
  );
};

export default PeopleAnalysis;
