import React, { useState, useEffect, useRef, useCallback } from 'react';
// Removed Firebase imports as they are now loaded globally from the CDN in index.html.

// IMPORTANT: These global variables are provided by the Canvas environment.
// Do NOT hardcode them or prompt the user for them.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Utility function to convert base64 to ArrayBuffer (for audio playback)
const base64ToArrayBuffer = (base64) => {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

// Utility function to convert PCM to WAV (for audio playback)
const pcmToWav = (pcmData, sampleRate) => {
  const numChannels = 1; // Mono audio
  const bytesPerSample = 2; // 16-bit PCM
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;

  const wavBuffer = new ArrayBuffer(44 + pcmData.byteLength);
  const view = new DataView(wavBuffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmData.byteLength, true);
  writeString(view, 8, 'WAVE');

  // FMT sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size
  view.setUint16(20, 1, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // BitsPerSample

  // DATA sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, pcmData.byteLength, true);

  // Write the PCM data
  for (let i = 0; i < pcmData.length; i++) {
    view.setInt16(44 + i * bytesPerSample, pcmData[i], true);
  }

  return new Blob([view], { type: 'audio/wav' });
};

const writeString = (view, offset, string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};


const App = () => {
    const canvasRef = useRef(null);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [drawingData, setDrawingData] = useState([]);
    const [currentTool, setCurrentTool] = useState('brush');
    const [brushColor, setBrushColor] = useState('#000000');
    const [brushSize, setBrushSize] = useState(5);
    const [isDrawing, setIsDrawing] = useState(false);
    const [lastX, setLastX] = useState(0);
    const [lastY, setLastY] = useState(0);
    const [aiPrompt, setAiPrompt] = useState('');
    const [generatedImageUrl, setGeneratedImageUrl] = useState('');
    const [isLoadingAI, setIsLoadingAI] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    // Initialize Firebase and set up auth listener
    useEffect(() => {
        // Check if firebase is available globally (loaded from CDN)
        if (typeof firebase === 'undefined' || typeof firebase.firestore === 'undefined' || typeof firebase.auth === 'undefined') {
            setErrorMessage("Firebase SDK not loaded. Please ensure it's included in index.html.");
            return;
        }

        // Access Firebase services via the global 'firebase' object
        const app = firebase.app(); // Get the default Firebase app
        const firestore = firebase.firestore(); // Get Firestore instance
        const firebaseAuth = firebase.auth(); // Get Auth instance

        setDb(firestore);
        setAuth(firebaseAuth);

        const unsubscribe = firebaseAuth.onAuthStateChanged(async (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                // Sign in anonymously if no user is logged in
                try {
                    if (initialAuthToken) {
                        await firebaseAuth.signInWithCustomToken(initialAuthToken);
                    } else {
                        await firebaseAuth.signInAnonymously();
                    }
                } catch (error) {
                    console.error("Firebase anonymous sign-in failed:", error);
                    setErrorMessage("Failed to sign in. Please try again.");
                }
            }
        });

        return () => unsubscribe();
    }, []); // Empty dependency array means this runs once on mount

    // Redraw canvas function - now a stable useCallback
    const redrawCanvas = useCallback((dataToDraw) => {
        const canvas = canvasRef.current;
        if (!canvas) {
            // console.log("Canvas not ready for redraw yet."); // For debugging
            return;
        }
        const ctx = canvas.getContext('2d');

        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Redraw all strokes
        dataToDraw.forEach(stroke => {
            if (stroke.x1 !== undefined && stroke.y1 !== undefined && stroke.x2 !== undefined && stroke.y2 !== undefined) {
                ctx.beginPath();
                ctx.moveTo(stroke.x1, stroke.y1);
                ctx.lineTo(stroke.x2, stroke.y2);
                ctx.strokeStyle = stroke.color;
                ctx.lineWidth = stroke.size;
                ctx.lineCap = 'round';
                ctx.stroke();
            } else if (stroke.type === 'image' && stroke.url) {
                // Draw generated image
                const img = new Image();
                img.onload = () => {
                    // Ensure the image is drawn only after it's loaded
                    ctx.drawImage(img, stroke.x, stroke.y, stroke.width, stroke.height);
                };
                img.src = stroke.url;
            }
        });
    }, []); // No dependencies here, as it takes data as an argument

    // Set up Firestore listener for drawing data
    useEffect(() => {
        if (!db || !userId) return;

        // Use a public collection for simplicity in this demo
        const drawingCollectionRef = db.collection(`artifacts/${appId}/public/data/drawings`);
        const q = drawingCollectionRef.orderBy('timestamp', 'asc').limit(500); // Limit for performance

        const unsubscribe = q.onSnapshot((snapshot) => {
            const data = [];
            snapshot.forEach(doc => {
                data.push(doc.data());
            });
            setDrawingData(data);
            redrawCanvas(data); // Call with the latest data
        }, (error) => {
            console.error("Error fetching drawing data:", error);
            setErrorMessage("Failed to load drawing data. Check console for details.");
        });

        return () => unsubscribe();
    }, [db, userId, redrawCanvas]); // redrawCanvas is now a stable dependency

    // Canvas drawing logic
    const draw = useCallback((e) => {
        if (!isDrawing) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();

        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        // Draw on local canvas immediately for responsiveness
        ctx.beginPath();
        ctx.moveTo(lastX, lastY);
        ctx.lineTo(currentX, currentY);
        ctx.strokeStyle = currentTool === 'brush' ? brushColor : '#ffffff'; // Eraser uses white color
        ctx.lineWidth = brushSize;
        ctx.lineCap = 'round';
        ctx.stroke();

        setLastX(currentX);
        setLastY(currentY);

        // Store stroke data to send to Firestore
        const stroke = {
            x1: lastX,
            y1: lastY,
            x2: currentX,
            y2: currentY,
            color: currentTool === 'brush' ? brushColor : '#ffffff', // Save eraser strokes as white
            size: brushSize,
            userId: userId, // Include user ID for attribution
            timestamp: firebase.firestore.FieldValue.serverTimestamp() // Firestore server timestamp
        };

        // Send stroke to Firestore (batching would be better for performance in a real app)
        if (db) {
            db.collection(`artifacts/${appId}/public/data/drawings`).add(stroke).catch(error => {
                console.error("Error adding drawing stroke to Firestore:", error);
                setErrorMessage("Failed to save stroke. Please check your connection.");
            });
        }
    }, [isDrawing, lastX, lastY, brushColor, brushSize, userId, db, currentTool]);

    const startDrawing = useCallback((e) => {
        setIsDrawing(true);
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        setLastX(e.clientX - rect.left);
        setLastY(e.clientY - rect.top);
    }, []);

    const stopDrawing = useCallback(() => {
        setIsDrawing(false);
    }, []);

    // Adjust canvas size to fit container
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) { // Only proceed if canvasRef.current is available
            const resizeCanvas = () => {
                // Set canvas dimensions to be responsive
                canvas.width = canvas.parentElement.clientWidth;
                canvas.height = window.innerHeight * 0.7; // Take up 70% of viewport height
                redrawCanvas(drawingData); // Redraw content after resize
            };

            resizeCanvas(); // Initial resize
            window.addEventListener('resize', resizeCanvas);
            return () => window.removeEventListener('resize', resizeCanvas);
        }
    }, [drawingData, redrawCanvas]); // drawingData and redrawCanvas are dependencies

    // Function to clear the entire drawing
    const clearCanvas = async () => {
        if (db) {
            const drawingCollectionRef = db.collection(`artifacts/${appId}/public/data/drawings`);
            try {
                const snapshot = await drawingCollectionRef.get();
                const batch = db.batch(); // Use writeBatch for multiple deletions
                snapshot.docs.forEach(doc => {
                    batch.delete(doc.ref);
                });
                await batch.commit();
                setDrawingData([]); // Clear local state after successful deletion
                setGeneratedImageUrl(''); // Clear generated image too
            } catch (error) {
                console.error("Error clearing canvas:", error);
                setErrorMessage("Failed to clear canvas. Please try again.");
            }
        }
    };


    // AI Image Generation Function
    const generateImage = async () => {
        if (!aiPrompt.trim()) {
            setErrorMessage("Please enter a prompt for AI image generation.");
            return;
        }

        setIsLoadingAI(true);
        setErrorMessage('');
        setGeneratedImageUrl('');

        try {
            // Using imagen-3.0-generate-002 for image generation
            const payload = { instances: { prompt: aiPrompt }, parameters: { "sampleCount": 1 } };
            const apiKey = ""; // Canvas will provide this at runtime
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(`API error: ${response.status} - ${errorData.error.message || response.statusText}`);
            }

            const result = await response.json();

            if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
                const imageUrl = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
                setGeneratedImageUrl(imageUrl);
            } else {
                setErrorMessage("No image generated. Please try a different prompt.");
            }
        } catch (error) {
            console.error("Error generating image:", error);
            setErrorMessage(`Error generating image: ${error.message}.`);
        } finally {
            setIsLoadingAI(false);
        }
    };

    // Function to add generated image to canvas
    const addImageToCanvas = () => {
        if (generatedImageUrl && db) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.onload = () => {
                // Position the image in the center or a default spot
                const imgWidth = Math.min(img.width, canvas.width / 2);
                const imgHeight = (img.height / img.width) * imgWidth;
                const x = (canvas.width - imgWidth) / 2;
                const y = (canvas.height - imgHeight) / 2;

                // Draw on local canvas
                ctx.drawImage(img, x, y, imgWidth, imgHeight);

                // Save image data to Firestore for collaboration
                const imageData = {
                    type: 'image',
                    url: generatedImageUrl,
                    x: x,
                    y: y,
                    width: imgWidth,
                    height: imgHeight,
                    userId: userId,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                };
                db.collection(`artifacts/${appId}/public/data/drawings`).add(imageData).catch(error => {
                    console.error("Error adding image to Firestore:", error);
                    setErrorMessage("Failed to add image to shared canvas.");
                });
            };
            img.src = generatedImageUrl;
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-purple-100 to-blue-100 flex flex-col items-center justify-center p-4 font-inter">
            {/* Tailwind CSS and Inter font are loaded in index.html now, so these script/link tags are removed from here */}
            {/* <script src="https://cdn.tailwindcss.com"></script> */}
            {/* <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" /> */}

            <div className="bg-white p-6 rounded-xl shadow-2xl w-full max-w-6xl flex flex-col lg:flex-row gap-6">
                {/* Control Panel */}
                <div className="lg:w-1/4 w-full flex flex-col gap-4 p-4 bg-gray-50 rounded-lg shadow-inner">
                    <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">AuraMart Art Studio</h2>

                    <div className="flex flex-col gap-2">
                        <label htmlFor="brushColor" className="text-gray-700 font-medium">Brush Color:</label>
                        <input
                            type="color"
                            id="brushColor"
                            value={brushColor}
                            onChange={(e) => setBrushColor(e.target.value)}
                            className="w-full h-10 rounded-md border border-gray-300 cursor-pointer"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label htmlFor="brushSize" className="text-gray-700 font-medium">Brush Size:</label>
                        <input
                            type="range"
                            id="brushSize"
                            min="1"
                            max="20"
                            value={brushSize}
                            onChange={(e) => setBrushSize(parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                        <span className="text-sm text-gray-600 text-center">{brushSize}px</span>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setCurrentTool('brush')}
                            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all duration-200 ${
                                currentTool === 'brush' ? 'bg-blue-600 text-white shadow-md' : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                            }`}
                        >
                            Brush
                        </button>
                        <button
                            onClick={() => setCurrentTool('eraser')}
                            className={`flex-1 py-2 px-4 rounded-lg font-semibold transition-all duration-200 ${
                                currentTool === 'eraser' ? 'bg-red-600 text-white shadow-md' : 'bg-red-100 text-red-800 hover:bg-red-200'
                            }`}
                        >
                            Eraser
                        </button>
                    </div>

                    <button
                        onClick={clearCanvas}
                        className="w-full py-2 px-4 bg-gray-700 text-white rounded-lg font-semibold hover:bg-gray-800 transition-all duration-200 shadow-md"
                    >
                        Clear Canvas
                    </button>

                    <div className="mt-6 border-t pt-4 border-gray-200">
                        <h3 className="text-xl font-bold text-gray-800 mb-3 text-center">AI Image Generation</h3>
                        <textarea
                            className="w-full p-2 border border-gray-300 rounded-md resize-none focus:ring-blue-500 focus:border-blue-500"
                            rows="3"
                            placeholder="Describe the image you want to generate (e.g., 'A cat wearing a wizard hat in space')"
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                        ></textarea>
                        <button
                            onClick={generateImage}
                            disabled={isLoadingAI}
                            className={`w-full py-2 px-4 mt-2 rounded-lg font-semibold transition-all duration-200 ${
                                isLoadingAI ? 'bg-green-300 cursor-not-allowed' : 'bg-green-600 text-white hover:bg-green-700 shadow-md'
                            }`}
                        >
                            {isLoadingAI ? 'Generating...' : 'Generate AI Image'}
                        </button>

                        {generatedImageUrl && (
                            <div className="mt-4 text-center">
                                <h4 className="font-semibold text-gray-700 mb-2">Generated Image:</h4>
                                <img src={generatedImageUrl} alt="Generated AI Art" className="max-w-full h-auto rounded-lg shadow-lg mx-auto" />
                                <button
                                    onClick={addImageToCanvas}
                                    className="w-full py-2 px-4 mt-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-all duration-200 shadow-md"
                                >
                                    Add to Canvas
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                {/* Canvas Area */}
                <div className="lg:w-3/4 w-full bg-gray-100 rounded-xl shadow-lg flex items-center justify-center overflow-hidden relative">
                    <canvas
                        ref={canvasRef}
                        onMouseDown={startDrawing}
                        onMouseUp={stopDrawing}
                        onMouseOut={stopDrawing}
                        onMouseMove={draw}
                        onTouchStart={(e) => {
                            const touch = e.touches[0];
                            startDrawing({ clientX: touch.clientX, clientY: touch.clientY });
                        }}
                        onTouchEnd={stopDrawing}
                        onTouchCancel={stopDrawing}
                        onTouchMove={(e) => {
                            const touch = e.touches[0];
                            draw({ clientX: touch.clientX, clientY: touch.clientY });
                        }}
                        className="border border-gray-300 rounded-lg cursor-crosshair"
                        style={{
                            backgroundColor: '#ffffff',
                            width: '100%',
                            height: '100%',
                            touchAction: 'none' // Prevent default touch actions like scrolling
                        }}
                    ></canvas>

                    {errorMessage && (
                        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500 text-white px-4 py-2 rounded-lg shadow-lg">
                            {errorMessage}
                        </div>
                    )}
                </div>
            </div>

            <div className="mt-6 text-gray-600 text-center text-sm">
                <p>Logged in as: <span className="font-semibold text-gray-800 break-all">{userId || 'Loading...'}</span></p>
                <p>This is a collaborative demo. Your drawings are shared in real-time.</p>
            </div>
        </div>
    );
};

export default App;
